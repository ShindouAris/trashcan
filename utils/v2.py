import gzip
import json
import pathlib
import zipfile
from data import RawReplayData, ReplayData
from logging import getLogger

log = getLogger(__name__)

def extract_mod(data: list) -> list:
    mod = []
    for tags in data:
        if tags["title"].startswith("Level Speed"):
            if int(tags["title"][-4:].replace("%", "")) > 100:
                mod.append("DT")
            else:
                mod.append("HT")
        elif tags["title"].startswith("Hidden"):
            mod.append("HD")
        else:
            mod.append(tags["title"])

    if len(mod) == 0:
        mod.append("NO-MOD")
    return mod

def rename_ext(file: pathlib.Path):
    log.info(f"Attempting to export replay file: {file}")

    if not file.exists():
        error_msg = f"Error: Input file '{file}' does not exist."
        log.error(error_msg)
        raise FileNotFoundError(error_msg)

    if not file.is_file():
        error_msg = f"Error: Input path '{file}' is a directory, not a file."
        log.error(error_msg)
        raise IsADirectoryError(error_msg)

    if file.suffix.lower() == '.zip':
        log.info(f"Info: File '{file}' already has a .zip extension. No rename needed.")
        return

    target_path = file.with_suffix('.zip')
    log.info(f"Target export path: {target_path}")

    if target_path.exists():
        error_msg = f"Error: Target file '{target_path}' already exists. Cannot overwrite."
        log.error(error_msg)
        raise FileExistsError(error_msg)
    try:
        file.rename(target_path)
        log.info(f"Successfully exported '{file.name}' to '{target_path.name}'.")
        return target_path
    except OSError as e:
        error_msg = f"Error exporting file '{file}' to '{target_path}': {e}"
        log.error(error_msg)
        raise

def extract_replay(file: pathlib.Path):
    if not file.suffix.lower() == '.zip':
        rename_ext(file)
        file = file.with_suffix('.zip')
    log.info(f"Extracting replay file: {file}")
    with zipfile.ZipFile(file, 'r') as zip_ref:
        zip_ref.extractall(file.parent)
    log.info(f"Replay file extracted to: {file.parent}")
    return file.parent / "sonolus"

def read_replay_data(folder: pathlib.Path):
    replay_folder = folder / "replays"
    _data: dict[str, dict] = {}
    for file in replay_folder.glob("local-*"):
        if not file.exists():
            return None
        with open(file, "r") as f:
            data = json.load(f)
        _data[file.name] = data
    return _data

def process_replay_files(data: dict) -> RawReplayData:
    return RawReplayData(
        name=data["item"]["name"],
        version=data["item"]["version"],
        title=data["item"]["title"],
        mod=extract_mod(data["item"]["tags"]),
        level=data["item"]["level"],
        rating=data["item"]["level"]["rating"],
        difficulty=data["item"]["level"]["tags"][0]["title"][1:],
        engine=data["item"]['level']["engine"],
        thumbnail=data["item"]['level']["engine"]["thumbnail"].get("url", ""),
        gameplay_data=data["item"]["data"]["url"]
    )

def decompress_gzip_file(input_file_path, output_file_path):
    if not input_file_path.exists():
        return None
    with gzip.open(input_file_path, 'rt') as data:
        jsonlines = [json.loads(line) for line in data]

    file = f"{output_file_path / input_file_path.name}.json"
    with open(file, 'w') as output_file:
        json.dump(jsonlines, output_file, indent=2)
        log.info(f"Decompressed file saved to: {output_file_path}")

    return file

def read_replay_data_file(file: pathlib.Path) -> list | None:
    if not file.exists():
        log.error(f"File {file} does not exist.")
        return None
    with open(file, "r") as f:
        data = json.load(f)
    return data

def parse_replay_data(metadata: RawReplayData, data: dict) -> ReplayData:
    return ReplayData.from_dict(metadata, data)

def main(filters: list = None):
    folder = pathlib.Path("./sonolus/repository/")
    decompress_folder = pathlib.Path("Export")
    decompress_folder.mkdir(parents=True, exist_ok=True)
    processed = 0
    for filter in filters:
        for file in folder.glob(str(filter)):
            try:
                decompress_gzip_file(file, decompress_folder)
                processed += 1
            except Exception as e:
                log.error(f"Error processing {file}: {e}")