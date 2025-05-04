import json
import time

def decode_delta(delta_array):
    if not isinstance(delta_array, (list, tuple)):
        print(f"Warning: decode_delta received non-list input: {type(delta_array)}. Returning empty list.")
        return []
    decoded = []
    current_value = 0.0
    for delta in delta_array:
        try:

            delta_val = float(delta)
        except (ValueError, TypeError):
            print(f"Warning: Could not convert delta value '{delta}' to float in decode_delta. Skipping.")
            continue

        current_value += delta_val
        decoded.append(current_value)
    return decoded

def load_replay(filepath):
    """Loads ReplayData from a plain (non-gzipped) JSON file."""
    try:
        with open(filepath, 'rt', encoding='utf-8') as f:
            replay_data_list = json.load(f)

        if not replay_data_list:
            print(f"Warning: No data found in {filepath}")
            return None

        if isinstance(replay_data_list, list) and len(replay_data_list) > 0:
            return replay_data_list[0]
        elif isinstance(replay_data_list, dict):
            print(f"Warning: JSON root is an object, not a list as expected. Using the object directly.")
            return replay_data_list
        else:
            print(f"Warning: Unexpected JSON structure in {filepath}.")
            return None

    except FileNotFoundError:
        print(f"Error: Replay file '{filepath}' not found.")
        return None
    except UnicodeDecodeError:
        print(f"Error: Failed to decode '{filepath}' as UTF-8.")
        return None
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse JSON from '{filepath}'. Details: {e}")
        return None
    except Exception as e:
        print(f"An unexpected error occurred loading '{filepath}': {e}")
        return None

def _accuracy(score) -> float:
    default = 1000000
    return (score / default) * 100


def run_viewer(replay_data):
    if not replay_data:
        print("Cannot run viewer, invalid replay data provided.")
        return

    try:
        if 'inputs' not in replay_data or 'time' not in replay_data['inputs']:
            print("Error: Replay data is missing 'inputs' or 'inputs.time'")
            return
        decoded_times = decode_delta(replay_data['inputs']['time'])

        if 'judgment' not in replay_data['inputs'] or 'accuracy' not in replay_data['inputs']:
            print("Error: Replay data is missing 'inputs.judgment' or 'inputs.accuracy'")
            return
        if 'duration' not in replay_data:
            print("Error: Replay data is missing 'duration'")
            return

        judgments = replay_data['inputs']['judgment']
        accuracies = replay_data['inputs']['accuracy']

        if len(decoded_times) != len(judgments) or len(decoded_times) != len(accuracies):
            print(f"Error: Mismatched lengths! Time:{len(decoded_times)}, Judg:{len(judgments)}, Acc:{len(accuracies)}")
            min_len = min(len(decoded_times), len(judgments), len(accuracies))
            decoded_times = decoded_times[:min_len]
            judgments = judgments[:min_len]
            accuracies = accuracies[:min_len]
            print(f"Warning: Truncating input arrays to minimum length: {min_len}")
            if min_len == 0: return

    except KeyError as e:
        print(f"Error: Missing expected key: {e}")
        return
    except Exception as e:
        print(f"An error occurred during data preparation: {e}")
        return

    processed_inputs = []
    for i in range(len(decoded_times)):
        processed_inputs.append({
            "index": i,
            "time": decoded_times[i],
            "judgment": judgments[i],
            "accuracy": accuracies[i]
        })

    if not processed_inputs:
        print("No input events to process.")
        duration = replay_data.get('duration', 0)
        print(f"--- Replay (Duration: {duration:.2f}s) ---")
        print("--- No input events ---")
        if 'result' in replay_data: print(f"Final Result: {replay_data['result']}")
        return

    processed_inputs.sort(key=lambda x: x['time'])

    duration = replay_data['duration']
    start_real_time = time.time()
    current_replay_time = 0.0
    next_event_index = 0
    combo = 0
    max_combo = 0

    judgment_map = {0: "Miss", 1: "Perfect", 2: "Great", 3: "Good"}

    print(f"--- Starting Replay (Duration: {duration:.2f}s) ---")
    print("!!! TESTING: player-v2 !!!")
    print("Idx | Time    | Judg Value | Judgment | Accuracy | Combo Before | Combo After | Combo ")
    print("----|---------|------------|----------|----------|--------------|-------------|-------")

    while current_replay_time <= duration:
        current_real_time = time.time()
        current_replay_time = current_real_time - start_real_time
        time.sleep(0.001)

        while next_event_index < len(processed_inputs) and \
                processed_inputs[next_event_index]['time'] <= current_replay_time:

            event = processed_inputs[next_event_index]
            original_idx = event['index']
            judg_val = event['judgment']
            judg_text = judgment_map.get(judg_val, f"Unknown")
            accuracy = event['accuracy']
            combo_before = combo

            match judg_val:
                case 0:
                    combo = 0
                case 1:
                    combo += 1
                case 2:
                    combo += 1
                case 3:
                    combo = 0

            max_combo = max(max_combo, combo)

            print(f"{original_idx:<3} | {event['time']:<7.3f} | {judg_val:<10} | {judg_text:<8} | {accuracy:<+8.4f} | {combo_before:<12} | {combo:<11} | {max_combo}")

            next_event_index += 1

        if next_event_index >= len(processed_inputs) and current_replay_time > duration + 0.5:
            print("\n--- Reached end of input events and duration ---")
            break

    end_real_time = time.time()

    print(f"\n--- Replay Finished ---")
    if 'result' in replay_data:
        print(f"Final Result (from data): {replay_data['result']}")
    else:
        print("No final result block found in replay data.")
    print("Accuracy (Live Calc):", _accuracy(replay_data['result']['accuracy']) if 'result' in replay_data else "N/A")
    print(f"Max Combo (Live Calc): {max_combo}")
    print(f"Total Time: {end_real_time - start_real_time:.2f}s")



replay_file = 'b7ab40e922ed57078f6423b3758ae15cf7d1b777.json'

data = load_replay(replay_file)
if data:
    run_viewer(data)