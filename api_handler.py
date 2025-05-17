import os
import time
import threading

import uvicorn
import uuid
import shutil
import zipfile
from fastapi.responses import JSONResponse
from fastapi import FastAPI, HTTPException, UploadFile, File
from pathlib import Path
from utils.v2 import (
    extract_replay,
    read_replay_data,
    process_replay_files,
    decompress_gzip_file,
    read_replay_data_file,
    parse_replay_data
)
from utils.v1 import (
    extract_replay as v1_extract_replay,
    read_replay_data as v1_read_replay_data,
    process_replay_files as v1_process_replay_files,
    decompress_gzip_file as v1_decompress_gzip_file,
    read_replay_data_file as v1_read_replay_data_file,
    parse_replay_data as v1_parse_replay_data
)
from fastapi.middleware.cors import CORSMiddleware
from logging import getLogger
import setup_logging


setup_logging.setup_logger()


class Client(FastAPI):
    def __init__(self):
        super().__init__()
        origins = ["*"]
        self.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        self.log = getLogger(__name__)
        self.log.info("API Handler Client initialized for V2 (multi-replay support).")
        self.add_api_route("/replayv2", self.send_replay, methods=["POST"])
        self.add_api_route("/replayv1", self.replay_v1_handler, methods=["POST"])

    @staticmethod
    def generate_uuid():
        return str(uuid.uuid4())

    @staticmethod
    def clean_up(f: Path):
        logger = getLogger(__name__)
        if f.exists() and f.is_dir():
            try:
                shutil.rmtree(f)
                logger.info(f"Successfully cleaned up temporary directory: {f}")
            except Exception as e:
                logger.error(f"Error during clean_up of {f}: {e}", exc_info=True)
        else:
            logger.info(f"Path {f} does not exist or is not a directory. No cleanup needed for {f}.")

    def raise_error(self, code, message) -> None:
        self.log.error(f"HTTPException raised: Status {code}, Detail: {message}")
        raise HTTPException(status_code=code, detail=message)

    async def send_replay(self, file: UploadFile = File(...)):
        """
        Endpoint v2
        """
        request_uuid = self.generate_uuid()
        self.log.info(f"[{request_uuid}] Received file: {file.filename}, Content-Type: {file.content_type}")

        if not file.filename.endswith('.zip') and not file.filename.endswith(".scp"):
            self.raise_error(code=400, message="File must be a .zip or a .scp (Sonolus Collection Package) archive.")

        temp_dir_for_request = Path(f"temp/processing_{request_uuid}")

        try:
            temp_dir_for_request.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            self.log.error(f"[{request_uuid}] Could not create temp directory {temp_dir_for_request}: {e}", exc_info=True)
            self.raise_error(code=500, message="Server error: Could not create temporary directory.")

        original_suffix = Path(file.filename).suffix
        target_filename = f"upload_archive_{request_uuid}{original_suffix}"
        uploaded_file_path = temp_dir_for_request / target_filename

        all_processed_replays_data = {}

        try:
            self.log.info(f"[{request_uuid}] Saving uploaded file to {uploaded_file_path}")
            with open(uploaded_file_path, "wb") as f_out:
                content = await file.read()
                f_out.write(content)

            self.log.info(f"[{request_uuid}] File saved. Extracting archive: {uploaded_file_path}")
            sonolus_content_dir = extract_replay(uploaded_file_path)
            self.log.info(f"[{request_uuid}] Archive extracted. Sonolus content root: {sonolus_content_dir}")

            if not sonolus_content_dir.exists() or not sonolus_content_dir.is_dir():
                self.raise_error(code=500, message="Archive structure error: Core content directory not found after extraction.")

            self.log.info(f"[{request_uuid}] Reading all replay item data from {sonolus_content_dir / 'replays'}")
            all_replay_items_map = read_replay_data(sonolus_content_dir)

            if not all_replay_items_map:
                self.raise_error(code=400, message="No replay item data (e.g., local-*.json) found in the archive's 'replays' folder.")

            self.log.info(f"[{request_uuid}] Found {len(all_replay_items_map)} replay item(s) to process.")

            for item_filename, item_content_json in all_replay_items_map.items():
                item_processing_uuid = self.generate_uuid()
                self.log.info(f"[{request_uuid}/{item_processing_uuid}] Processing replay item: {item_filename}")

                item_temp_decompression_dir = temp_dir_for_request / f"item_{item_processing_uuid}_decompressed"
                item_temp_decompression_dir.mkdir(exist_ok=True)

                try:
                    raw_replay_metadata = process_replay_files(item_content_json)
                    if not raw_replay_metadata:
                        self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Failed to process metadata for {item_filename}. Skipping.")
                        all_processed_replays_data[item_filename] = {"error": "Failed to process metadata from item JSON."}
                        continue

                    gameplay_data_url_in_json = raw_replay_metadata.gameplay_data
                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Raw gameplay data URL from JSON: {gameplay_data_url_in_json}")

                    path_suffix_from_url = Path(gameplay_data_url_in_json)
                    path_inside_sonolus_dir: Path
                    if str(path_suffix_from_url).lower().startswith(("/sonolus/", "\\sonolus\\")):
                        path_inside_sonolus_dir = Path(*path_suffix_from_url.parts[2:])
                    else:
                        path_inside_sonolus_dir = Path(str(path_suffix_from_url).lstrip('/\\'))

                    gameplay_data_gzip_path = (sonolus_content_dir / path_inside_sonolus_dir).resolve()

                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Sonolus content directory: {sonolus_content_dir}")
                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Calculated path suffix from URL: {path_inside_sonolus_dir}")
                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Attempting to locate GZIP file at: {gameplay_data_gzip_path}")

                    try:
                        resolved_sonolus_content_dir = sonolus_content_dir.resolve()
                        resolved_gameplay_data_path = gameplay_data_gzip_path # Already resolved

                        is_safe_path = False
                        # Python 3.9+ Path.is_relative_to is preferred
                        if hasattr(Path, 'is_relative_to'):
                            if resolved_gameplay_data_path.is_relative_to(resolved_sonolus_content_dir):
                                is_safe_path = True
                        else: # Fallback for older Python versions
                            try:
                                common = Path(os.path.commonpath([str(resolved_sonolus_content_dir), str(resolved_gameplay_data_path)]))
                                if common == resolved_sonolus_content_dir:
                                    is_safe_path = True
                            except ValueError:
                                is_safe_path = False

                        if not is_safe_path:
                            self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Security Alert or Path Mismatch: Resolved GZIP path {resolved_gameplay_data_path} is not confirmed to be within {resolved_sonolus_content_dir}. Check archive structure and JSON URLs.")
                            # Optionally, add a fallback or raise an error here if strict path checking is required
                            # For now, we'll proceed but this warning is important.
                    except Exception as e_path_check:
                        self.log.error(f"[{request_uuid}/{item_processing_uuid}] Error during path safety check: {e_path_check}", exc_info=True)


                    if not gameplay_data_gzip_path.exists():
                        self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Gameplay data GZIP file not found for {item_filename} at {gameplay_data_gzip_path}. Skipping.")
                        all_processed_replays_data[item_filename] = {"error": f"Gameplay data GZIP file not found at expected location: {gameplay_data_gzip_path.name}"}
                        continue

                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Decompressing GZIP file: {gameplay_data_gzip_path} for {item_filename}")
                    decompressed_gameplay_json_path_str = decompress_gzip_file(gameplay_data_gzip_path, item_temp_decompression_dir)

                    if not decompressed_gameplay_json_path_str:
                        self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Failed to decompress GZIP for {item_filename}. Skipping.")
                        all_processed_replays_data[item_filename] = {"error": "Failed to decompress gameplay GZIP data."}
                        continue

                    decompressed_gameplay_json_path = Path(decompressed_gameplay_json_path_str)
                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Decompressed GZIP to JSON: {decompressed_gameplay_json_path} for {item_filename}")

                    gameplay_frames_list = read_replay_data_file(decompressed_gameplay_json_path)
                    if gameplay_frames_list is None:
                        self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Failed to read/parse decompressed JSON for {item_filename}. Skipping.")
                        all_processed_replays_data[item_filename] = {"error": "Failed to read or parse decompressed gameplay data JSON."}
                        continue

                    if not isinstance(gameplay_frames_list, list) or len(gameplay_frames_list) == 0:
                        self.log.warning(f"[{request_uuid}/{item_processing_uuid}] Decompressed data for {item_filename} is not a list or is empty. Skipping.")
                        all_processed_replays_data[item_filename] = {"error": "Decompressed gameplay data is not in expected list format or is empty."}
                        continue

                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Parsing final replay object for {item_filename}...")
                    parsed_single_replay_data = parse_replay_data(raw_replay_metadata, gameplay_frames_list[0])

                    all_processed_replays_data[item_filename] = parsed_single_replay_data.to_dict()
                    self.log.info(f"[{request_uuid}/{item_processing_uuid}] Successfully processed {item_filename}.")

                except KeyError as e:
                    self.log.error(f"[{request_uuid}/{item_processing_uuid}] Missing key during processing of {item_filename}: {e}", exc_info=True)
                    all_processed_replays_data[item_filename] = {"error": f"Missing expected data key '{e}' for item {item_filename}."}
                except Exception as e:
                    self.log.error(f"[{request_uuid}/{item_processing_uuid}] Unhandled error processing item {item_filename}: {e}", exc_info=True)
                    all_processed_replays_data[item_filename] = {"error": f"Unexpected server error processing item {item_filename}: {type(e).__name__}."}
                finally:
                    self.clean_up(item_temp_decompression_dir)

            if not all_processed_replays_data:
                self.log.warning(f"[{request_uuid}] No replay items could be successfully processed from the archive.")
                self.raise_error(code=400, message="No replay items in the archive could be successfully processed.")

            self.log.info(f"[{request_uuid}] Processing complete. Returning data for {len(all_processed_replays_data)} item(s).")
            return JSONResponse(content=all_processed_replays_data)

        except HTTPException:
            raise
        except FileNotFoundError as e:
            self.log.error(f"[{request_uuid}] File not found error during global processing: {e}", exc_info=True)
            self.raise_error(code=404, message=f"A required file or directory was not found: {e.filename or e}")
        except (zipfile.BadZipFile, zipfile.LargeZipFile) as e:
            self.log.warning(f"[{request_uuid}] Invalid or unsupported ZIP/SCP file: {e}", exc_info=True)
            self.raise_error(code=400, message=f"The provided archive file is invalid or unsupported: {e}")
        except KeyError as e:
            self.log.error(f"[{request_uuid}] Missing expected key in archive structure: {e}", exc_info=True)
            self.raise_error(code=400, message=f"Archive content is missing expected data or has incorrect structure (Global KeyError: {e}).")
        except Exception as e:
            self.log.error(f"[{request_uuid}] Unhandled global error in send_replay: {e}", exc_info=True)
            self.raise_error(code=500, message=f"An unexpected server error occurred: {type(e).__name__}.")
        finally:
            self.log.info(f"[{request_uuid}] Cleaning up main temporary directory: {temp_dir_for_request}")
            self.clean_up(temp_dir_for_request)

    async def replay_v1_handler(self, file: UploadFile = File(...)):
        """
        Endpoint v1
        """
        self.log.info(f"Received file: {file.filename}")
        if not file.filename.endswith('.zip') and not file.filename.endswith(".scp"):
            self.raise_error(code=400, message="File must be a zip or a vaild sonolus collection archive.")
            return

        session_uuid = self.generate_uuid()
        file_location = Path(f"temp/{session_uuid}/")

        file_location.mkdir(parents=True, exist_ok=True)

        with open(file_location / f"replay-data-{session_uuid}.scp", "wb") as f:
            content = await file.read()
            f.write(content)
            f.close()

        f = next(file_location.glob("*.scp"), None)
        if f is None:
            self.log.warning(f"[{session_uuid}] Replay file not found in the uploaded archive")
            self.clean_up(file_location)
            self.raise_error(code=502, message="Replay file not found in the uploaded archive.")
            return

        data = v1_extract_replay(f)
        jsondata = v1_read_replay_data(data)

        if not jsondata:
            self.log.warning(f"[{session_uuid}] Replay data not found in the uploaded archive.")
            self.clean_up(file_location)
            self.raise_error(code=400, message="Replay data not found in the uploaded archive.")
            return

        replay_data = v1_process_replay_files(jsondata)
        gameplay_data_gzip = Path("." + replay_data.gameplay_data)

        if not gameplay_data_gzip.exists():
            self.clean_up(file_location)
            self.raise_error(code=400, message="Gameplay data file not found in the uploaded archive.")
            return

        file_replay = v1_decompress_gzip_file(gameplay_data_gzip, file_location)

        if not file_replay:
            self.log.warning(f"[{session_uuid}] Failed to decompress gameplay data file.")
            self.clean_up(file_location)
            self.raise_error(code=400, message="Failed to decompress / search for replay data.")
            return

        replay_data_rel = v1_read_replay_data_file(Path(file_replay))
        final_data = v1_parse_replay_data(replay_data, replay_data_rel[0])

        self.clean_up(file_location)

        return JSONResponse(content=final_data.to_dict())

def keep_alive():
    """
    Keep the server alive
    """
    try:
        while True:
            logger.debug("Still Alive...")
            time.sleep(40)
    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    logger = getLogger(__name__)
    logger.info("Starting server on port 8000 using uvicorn...")
    threading.Thread(target=keep_alive, daemon=True).start()
    uvicorn.run(Client, factory=True, host="0.0.0.0", port=8000, log_config=setup_logging.LOGGING_CONFIG)