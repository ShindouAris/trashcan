import uvicorn
import uuid
from fastapi.responses import JSONResponse
from fastapi import FastAPI, HTTPException, UploadFile, File
from pathlib import Path
from utils import *
from fastapi.middleware.cors import CORSMiddleware
import shutil
import json

class Client(FastAPI):
    def __init__(self):
        super().__init__()
        origins = ["http://localhost:63342"]
        self.add_middleware(
            CORSMiddleware,
            allow_origins=origins, # List of allowed origins
            allow_credentials=True, # Allow cookies if needed (usually yes)
            allow_methods=["*"],    # Allow all standard methods (GET, POST, etc.)
            allow_headers=["*"],    # Allow all standard headers
        )
        self.add_api_route("/replay", self.send_replay, methods=["POST"])

    @staticmethod
    def generate_uuid():
        """
        Generate a unique UUID.
        """
        return str(uuid.uuid4())

    async def send_replay(self, file: UploadFile = File(...)):
        """
        Endpoint to receive a replay file and return its UUID.
        """
        print(f"Received file: {file.filename}")
        if not file.filename.endswith('.zip') and not file.filename.endswith(".scp"):
            raise HTTPException(status_code=400, detail="File must be a zip or a vaild sonolus collection archive.")

        session_uuid = self.generate_uuid()
        file_location = Path(f"temp/{session_uuid}/")

        file_location.mkdir(parents=True, exist_ok=True)

        with open(file_location / f"replay-data-{session_uuid}.scp", "wb") as f:
            content = await file.read()
            f.write(content)
            f.close()

        f = next(file_location.glob("*.scp"), None)
        if f is None:
            f = next(file_location.glob("*.zip"), None)
            if f is None:
                self.clean_up(file_location)
                raise HTTPException(status_code=502, detail="Replay file not found in the uploaded archive.")
        data = extract_replay(f)
        jsondata = read_replay_data(data)
        replay_data = process_replay_files(jsondata)
        gameplay_data_raw = Path("." + replay_data.gameplay_data)
        if not gameplay_data_raw.exists():
            self.clean_up(file_location)
            raise HTTPException(status_code=502, detail="Gameplay data file not found in the uploaded archive.")
        file_replay = decompress_gzip_file(gameplay_data_raw, file_location)
        replay_data_rel = read_replay_data_file(Path(file_replay))

        final_data = parse_replay_data(replay_data, replay_data_rel[0])

        # Clean up the temporary files
        for file in file_location.glob("*.zip"):
            file.unlink()
        if file_location.exists() and file_location.is_dir():
            shutil.rmtree(file_location)

        print("Replay data processed successfully.")
        print("Replay data:", final_data.to_dict()) # Debugging line
        return JSONResponse(content=final_data.to_dict())

    def clean_up(self, f: Path):
        if f.exists() and f.is_dir():
            shutil.rmtree(f)
            print("Cleaning up success")

if __name__ == '__main__':
    app = Client()
    print("Starting server on http://localhost:8000/replay")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")


