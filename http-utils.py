import time
import json
import re
import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
import time # For monotonic

# --- Synchronous Data Parsing (Keep as is) ---
def parse_replay_log(filepath="replay_log.txt"):
    """Parses the provided text log into a list of event dictionaries."""
    # ... (Keep the exact same parsing logic as before) ...
    events = []
    line_regex = re.compile(
        r"^\s*(?P<Idx>\d+)\s*\|\s*"
        r"(?P<Time>\d+\.\d+)\s*\|\s*"
        r"(?P<JudgValue>\d+)\s*\|\s*"
        r"(?P<Judgment>\w+)\s*\|\s*"
        r"(?P<Accuracy>[+\-]?\d+\.\d+)\s*\|\s*"
        r"(?P<ComboBefore>\d+)\s*\|\s*"
        r"(?P<ComboAfter>\d+)\s*\|\s*"
        r"(?P<MaxCombo>\d+)\s*$"
    )
    header_found = False
    total_duration = 0.0
    final_result = {}
    try:
        with open(filepath, 'r') as f:
            for line in f:
                line = line.strip()
                if not line: continue
                if "--- Starting Replay" in line:
                    match = re.search(r"Duration:\s*([\d.]+)", line)
                    if match: total_duration = float(match.group(1))
                    continue
                if line.startswith("Idx | Time"):
                    header_found = True; continue
                if not header_found: continue
                if "--- Replay Finished ---" in line: break
                if "Final Result (from data):" in line:
                    try:
                        result_str = line.split("Final Result (from data):", 1)[1].strip()
                        final_result = eval(result_str)
                    except Exception as e: print(f"W: Could not parse final result: {e}")
                    continue
                match = line_regex.match(line)
                if match:
                    event_data = match.groupdict()
                    try:
                        event_data['Idx'] = int(event_data['Idx'])
                        event_data['Time'] = float(event_data['Time'])
                        event_data['JudgValue'] = int(event_data['JudgValue'])
                        event_data['Accuracy'] = float(event_data['Accuracy'])
                        event_data['ComboBefore'] = int(event_data['ComboBefore'])
                        event_data['ComboAfter'] = int(event_data['ComboAfter'])
                        event_data['MaxCombo'] = int(event_data['MaxCombo'])
                        events.append(event_data)
                    except ValueError as e: print(f"W: Skipping line parse error: {line} - {e}")
    except FileNotFoundError: print(f"E: File not found: {filepath}"); return [], 0.0, {}
    except Exception as e: print(f"E: Error parsing: {e}"); return [], 0.0, {}
    return events, total_duration, final_result
# --- End Data Parsing ---


# --- FastAPI App Setup ---
app = FastAPI()
templates = Jinja2Templates(directory="templates")

# --- Constants ---
CLOCK_UPDATE_INTERVAL = 0.1 # Seconds (e.g., update time 10 times per second)
QUEUE_SENTINEL = "DONE" # Special message to signal end

# --- Producer Task: Replay Events ---
async def replay_event_producer(queue: asyncio.Queue, events: list, start_sim_time: float):
    """Processes events based on timestamp and puts them onto the queue."""
    print("Replay producer started.")
    live_combo = 0
    live_max_combo = 0
    judgments = {'Perfect': 0, 'Great': 0, 'Good': 0, 'Miss': 0}
    accuracy_sum = 0.0
    hit_count = 0
    event_index = 0

    try:
        for event in events:
            target_elapsed_time = event['Time']
            current_elapsed_time = time.monotonic() - start_sim_time
            wait_time = target_elapsed_time - current_elapsed_time
            if wait_time > 0:
                await asyncio.sleep(wait_time)

            # Update live stats (same logic)
            judgment_name = event['Judgment']
            if judgment_name in judgments: judgments[judgment_name] += 1
            if judgment_name != 'Miss':
                live_combo += 1
                hit_count += 1
                accuracy_sum += event['Accuracy']
            else: live_combo = 0
            if live_combo > live_max_combo: live_max_combo = live_combo
            event_index += 1

            # Prepare the replay event packet
            replay_packet = {
                'type': 'update', # Keep 'update' type for consistency on frontend
                'event': event,
                'live_summary': {
                    'combo': live_combo, 'maxCombo': live_max_combo, 'judgments': judgments,
                    'eventTime': event['Time'], 'accuracySum': accuracy_sum,
                    'hitCount': hit_count, 'eventIndex': event_index
                }
            }
            await queue.put(replay_packet)

    except asyncio.CancelledError:
        print("Replay producer cancelled.")
    except Exception as e:
        print(f"Error in replay producer: {e}")
        # Optionally put an error message onto the queue
        await queue.put({'type': 'error', 'message': f'Replay producer error: {e}'})
    finally:
        # Signal that this producer is finished
        await queue.put(QUEUE_SENTINEL)
        print("Replay producer finished.")


# --- Producer Task: Real-time Clock ---
async def clock_producer(queue: asyncio.Queue, start_sim_time: float):
    """Periodically puts the current elapsed time onto the queue."""
    print("Clock producer started.")
    try:
        while True: # Keep running until cancelled
            elapsed_time = time.monotonic() - start_sim_time
            clock_packet = {
                'type': 'clock', # New type for clock updates
                'elapsedTime': elapsed_time
            }
            await queue.put(clock_packet)
            await asyncio.sleep(CLOCK_UPDATE_INTERVAL) # Wait before sending next update
    except asyncio.CancelledError:
        print("Clock producer cancelled.")
        # No need to put sentinel here, replay producer handles that
    except Exception as e:
        print(f"Error in clock producer: {e}")
        await queue.put({'type': 'error', 'message': f'Clock producer error: {e}'})


# --- Main SSE Stream Generator (Consumer) ---
async def stream_combined_events():
    """Combines replay events and clock updates from a queue into an SSE stream."""
    events, total_duration, final_result_from_log = parse_replay_log()
    num_events = len(events)

    if not events:
        yield f"data: {json.dumps({'type': 'error', 'message': 'No events parsed.'})}\n\n"
        return

    event_queue = asyncio.Queue()
    start_sim_time = time.monotonic() # Single start time reference

    # Start producer tasks
    replay_task = asyncio.create_task(
        replay_event_producer(event_queue, events, start_sim_time)
    )
    clock_task = asyncio.create_task(
        clock_producer(event_queue, start_sim_time)
    )

    # Yield initial start message
    initial_state = {
        'type': 'start', 'totalDuration': total_duration, 'totalNotes': num_events,
        'finalLogData': final_result_from_log, 'mode': 'realtime_timestamp_with_clock'
    }
    yield f"data: {json.dumps(initial_state)}\n\n"

    # Consume messages from the queue
    processed_event_count = 0
    stream_start_time = time.monotonic()
    try:
        while True:
            message = await event_queue.get()

            if message == QUEUE_SENTINEL:
                print("Received sentinel, stopping stream.")
                break # Replay producer finished

            if message.get('type') == 'update':
                processed_event_count += 1

            # --- Add actualElapsedTime to clock messages too for frontend ---
            if message.get('type') == 'clock':
                message['actualElapsedTime'] = message.get('elapsedTime', 0)

            # --- Add actualElapsedTime to replay messages ---
            elif message.get('type') == 'update':
                if 'live_summary' in message:
                    message['live_summary']['actualElapsedTime'] = time.monotonic() - start_sim_time


            # Serialize and send the message
            try:
                json_string = json.dumps(message)
                yield f"data: {json_string}\n\n"
            except Exception as json_err:
                print(f"ERROR serializing message: {json_err}")
                print(f"Problematic message data: {message}")
                # Optionally yield error, but might be better to stop/log

            event_queue.task_done() # Mark message as processed

    except asyncio.CancelledError:
        print("Main stream consumer cancelled (client disconnected?).")
    except Exception as e:
        print(f"Error in main stream consumer: {e}")
    finally:
        print("Cleaning up tasks...")
        # Ensure producer tasks are cancelled if the consumer stops early
        if not replay_task.done():
            replay_task.cancel()
        if not clock_task.done():
            clock_task.cancel()
        # Wait briefly for tasks to finish cancelling
        await asyncio.gather(replay_task, clock_task, return_exceptions=True)
        print("Tasks cleanup finished.")

        stream_end_time = time.monotonic()
        actual_processing_time = stream_end_time - stream_start_time
        print(f"Stream finished or cancelled. Actual duration: {actual_processing_time:.2f}s")

        # Send final 'end' message ONLY if replay completed fully
        if processed_event_count == num_events:
            # Extract final stats from the last event if needed, or calculate separately
            final_summary = {
                'type': 'end',
                'message': f'Replay Finished. Actual time: {actual_processing_time:.2f}s',
                'finalLogData': final_result_from_log,
                # Include final live stats if available/needed
            }
            try:
                yield f"data: {json.dumps(final_summary)}\n\n"
            except Exception as json_err:
                print(f"ERROR serializing final summary: {json_err}")


# --- FastAPI Routes ---
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """Serves the main HTML page."""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/stream")
async def stream_events():
    """Endpoint for the combined SSE stream."""
    return StreamingResponse(stream_combined_events(), media_type="text/event-stream")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("http-utils:app", host="localhost", port=8000, reload=True)