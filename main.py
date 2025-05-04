import gzip
import json
import pathlib
import zipfile
from data import RawReplayData

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
    return mod

def rename_ext(file: pathlib.Path):
    """
    Exports a replay file by renaming it to have a .zip extension.

    Assumes the input file is essentially a zip archive without the
    correct extension.

    :param file: Path object representing the input replay file.
    :return: None
    :raises FileNotFoundError: If the input file does not exist.
    :raises IsADirectoryError: If the input path is a directory.
    :raises FileExistsError: If a file with the target .zip name already exists.
    :raises OSError: If renaming fails due to other OS-level issues (e.g., permissions).
    """

    print(f"Attempting to export replay file: {file}")

    if not file.exists():
        error_msg = f"Error: Input file '{file}' does not exist."
        print(error_msg)
        raise FileNotFoundError(error_msg)

    if not file.is_file():
        error_msg = f"Error: Input path '{file}' is a directory, not a file."
        print(error_msg)
        raise IsADirectoryError(error_msg)

    if file.suffix.lower() == '.zip':
        print(f"Info: File '{file}' already has a .zip extension. No rename needed.")
        return

    target_path = file.with_suffix('.zip')
    print(f"Target export path: {target_path}")

    if target_path.exists():
        error_msg = f"Error: Target file '{target_path}' already exists. Cannot overwrite."
        print(error_msg)
        raise FileExistsError(error_msg)
    try:
        file.rename(target_path)
        print(f"Successfully exported '{file.name}' to '{target_path.name}'.")
        return target_path
    except OSError as e:
        error_msg = f"Error exporting file '{file}' to '{target_path}': {e}"
        print(error_msg)
        raise

def extract_replay(file: pathlib.Path):
    if not file.suffix.lower() == '.zip':
        rename_ext(file)
    print(f"Extracting replay file: {file}")
    with zipfile.ZipFile(file, 'r') as zip_ref:
        zip_ref.extractall(file.parent)
    print(f"Replay file extracted to: {file.parent}")
    return file.parent / "sonolus"

def read_replay_data(folder: pathlib.Path):
    replay_folder = folder / "replays"
    for file in replay_folder.glob("local-*"):
        with open(file, "r") as f:
            data = json.load(f)
        return data

def process_replay_files(data: dict) -> RawReplayData:
    return RawReplayData(
        name=data["item"]["name"],
        version=data["item"]["version"],
        title=data["item"]["title"],
        mod=extract_mod(data["item"]["tags"]),
        level=data["item"]["level"],
        difficulty=data["item"]["level"]["tags"][0]["title"][1:],
        engine=data["item"]['level']["engine"],
        thumbnail=data["item"]['level']["engine"]["thumbnail"]["url"],
        gameplay_data=data["item"]["data"]["url"]
    )

def decompress_gzip_file(input_file_path, output_file_path):
    """
    Decompress a gzip file and save the output to a new file.

    :param input_file_path: Path to the input gzip file.
    :param output_file_path: Path to save the decompressed file.
    """
    with gzip.open(input_file_path, 'rt') as data:
        jsonlines = [json.loads(line) for line in data]

    with open(f"{output_file_path / input_file_path.name}.json", 'w') as output_file:
        json.dump(jsonlines, output_file, indent=2)

    print("Decompressed file saved to:", output_file_path)

def main(filters: list = None):
    global processed
    global decompress_folder
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
                print(f"Error processing {file}: {e}")

if __name__ == '__main__':
    f = pathlib.Path("./test-v2.zip")
    decompress_folder = pathlib.Path("Export")
    decompress_folder.mkdir(parents=True, exist_ok=True)
    data = extract_replay(f)

    jsondata = read_replay_data(data)

    replay_data = process_replay_files(jsondata)
    gp_data  = pathlib.Path("." + replay_data.gameplay_data)
    decompress_gzip_file(gp_data, decompress_folder)

    print(json.dumps(replay_data.dump(), indent=2))