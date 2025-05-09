import uvicorn
import uuid
from fastapi.responses import JSONResponse
from fastapi import FastAPI, HTTPException, UploadFile, File
from pathlib import Path
from utils import *
from fastapi.middleware.cors import CORSMiddleware
import shutil

class Client(FastAPI):
    def __init__(self):
        super().__init__()
        origins = ["http://localhost:63342"]
        self.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        self.add_api_route("/replay", self.send_replay, methods=["POST"])

    @staticmethod
    def generate_uuid():
        """
        Generate a unique UUID.
        """
        return str(uuid.uuid4())

    @staticmethod
    def clean_up(f: Path):
        if f.exists() and f.is_dir():
            shutil.rmtree(f)
            print("Cleaning up success")

    def raise_error(self, code, message) -> None:
        """
        Raise an HTTPException with a given code and message.
        """
        raise HTTPException(status_code=code, detail=message)

    async def send_replay(self, file: UploadFile = File(...)):
        """
        Endpoint to receive a replay file and return its UUID.
        """
        print(f"Received file: {file.filename}")
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
            self.clean_up(file_location)
            self.raise_error(code=502, message="Replay file not found in the uploaded archive.")
            return

        data = extract_replay(f)
        jsondata = read_replay_data(data)

        if not jsondata:
            self.clean_up(file_location)
            self.raise_error(code=400, message="Replay data not found in the uploaded archive.")
            return

        replay_data = process_replay_files(jsondata)
        gameplay_data_gzip = Path("." + replay_data.gameplay_data)

        if not gameplay_data_gzip.exists():
            self.clean_up(file_location)
            self.raise_error(code=400, message="Gameplay data file not found in the uploaded archive.")
            return

        file_replay = decompress_gzip_file(gameplay_data_gzip, file_location)

        if not file_replay:
            self.clean_up(file_location)
            self.raise_error(code=400, message="Failed to decompress / search for replay data.")
            return

        replay_data_rel = read_replay_data_file(Path(file_replay))
        final_data = parse_replay_data(replay_data, replay_data_rel[0])

        # Clean up the temporary files
        self.clean_up(file_location)

        return JSONResponse(content=final_data.to_dict())



if __name__ == '__main__':
    print("Starting server on http://localhost:8000/replay")
    uvicorn.run(Client, host="0.0.0.0", port=8000, log_level="info")


