const fileUploadInput = document.getElementById('replayUploadFile');
const uploadButton = document.getElementById('uploadButton');
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status').querySelector('p');
const displayElement = document.getElementById('display');
const replaySelectorContainer = document.getElementById('replay-selector-container');

const songTitleElement = document.getElementById('song-title');
const songArtistElement = document.getElementById('song-artist');
const songDifficultyElement = document.getElementById('song-difficulty');
const songRatingElement = document.getElementById('song-rating');
const perfectCountElement = document.getElementById('perfect-count');
const greatCountElement = document.getElementById('great-count');
const goodCountElement = document.getElementById('good-count');
const missCountElement = document.getElementById('miss-count');
const currentTimeElement = document.getElementById('current-time');
const totalDurationElement = document.getElementById('total-duration');
const currentComboElement = document.getElementById('current-combo');
const maxComboElement = document.getElementById('max-combo');
const visualizerWrapper = document.getElementById('visualizer-container');
const canvas = document.getElementById('accuracy-visualizer');
const ctx = canvas.getContext('2d');

const BACKEND_UPLOAD_URL = 'http://192.168.1.10:8000/replayv2';

let allReplaysData = null;
let currentReplayKey = null;
let currentReplayData = null;
let processedInputs = [];
let simulationRunning = false;
let animationFrameId = null;
let simulationStartTimeMs = 0;
let nextEventIndex = 0;
let combo = 0, maxCombo = 0;
let perfectCount = 0, greatCount = 0, goodCount = 0, missCount = 0;
let duration = 0;
let activeLines = [];
const judgmentVizColorMap = { 0: "#e74c3c", 1: "#00a6ff", 2: "#3498db", 3: "#f1c40f", default: "#95a5a6" };

const VISUALIZER_ACCURACY_RANGE = 0.15;
const ACCURACY_THRESHOLDS = { PERFECT: 0.043, GREAT: 0.083, GOOD: 0.128, MISS: 0.130 };
const ACCURACY_BAR_COLORS = { PERFECT: "#b7ecec", GREAT: "#90EE90", GOOD: "#FFD700", MISS: "#FF0000" };
const LINE_FADE_DURATION_MS = 3000;


function decodeDelta(deltaArray) {
    if (!Array.isArray(deltaArray)) { console.warn(`Invalid delta time format.`); updateStatus(`Error: Invalid delta time format.`, true); return []; }
    const decoded = []; let currentValue = 0.0;
    for (const delta of deltaArray) {
        const deltaVal = parseFloat(delta);
        if (isNaN(deltaVal)) { console.warn(`Skipping non-float delta: '${delta}'`); continue; }
        currentValue += deltaVal; decoded.push(currentValue);
    } return decoded;
}

function updateStatus(message, isError = false) {
    statusElement.textContent = message; statusElement.style.color = isError ? 'red' : '#555'; console.log(message);
}

function mapAccuracyToX(accuracy, canvasWidth, maxAbsAccuracy) {
    const normalized = (accuracy + maxAbsAccuracy) / (2 * maxAbsAccuracy); const clamped = Math.max(0, Math.min(1, normalized)); return clamped * canvasWidth;
}

function drawVisualizerBackground() {
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const maxDisplayTimeOffset = VISUALIZER_ACCURACY_RANGE;

    ctx.fillStyle = ACCURACY_BAR_COLORS.MISS;
    let x_start_miss_outer = mapAccuracyToX(-maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
    let x_end_miss_outer = mapAccuracyToX(maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
    ctx.fillRect(x_start_miss_outer, 0, x_end_miss_outer - x_start_miss_outer, canvasHeight);

    ctx.fillStyle = ACCURACY_BAR_COLORS.GOOD;
    let x_start_good = mapAccuracyToX(-ACCURACY_THRESHOLDS.GOOD, canvasWidth, maxDisplayTimeOffset);
    let x_end_good = mapAccuracyToX(ACCURACY_THRESHOLDS.GOOD, canvasWidth, maxDisplayTimeOffset);
    ctx.fillRect(x_start_good, 0, x_end_good - x_start_good, canvasHeight);

    ctx.fillStyle = ACCURACY_BAR_COLORS.GREAT;
    let x_start_great = mapAccuracyToX(-ACCURACY_THRESHOLDS.GREAT, canvasWidth, maxDisplayTimeOffset);
    let x_end_great = mapAccuracyToX(ACCURACY_THRESHOLDS.GREAT, canvasWidth, maxDisplayTimeOffset);
    ctx.fillRect(x_start_great, 0, x_end_great - x_start_great, canvasHeight);

    ctx.fillStyle = ACCURACY_BAR_COLORS.PERFECT;
    let x_start_perfect = mapAccuracyToX(-ACCURACY_THRESHOLDS.PERFECT, canvasWidth, maxDisplayTimeOffset);
    let x_end_perfect = mapAccuracyToX(ACCURACY_THRESHOLDS.PERFECT, canvasWidth, maxDisplayTimeOffset);
    ctx.fillRect(x_start_perfect, 0, x_end_perfect - x_start_perfect, canvasHeight);

    const centerX = canvasWidth / 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvasHeight);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

/**
 * Resets state related to a single replay simulation, but keeps allReplaysData.
 */
function resetCurrentReplayState() {
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    simulationRunning = false;
    currentReplayKey = null;
    currentReplayData = null;
    processedInputs = [];
    nextEventIndex = 0; combo = 0; maxCombo = 0;
    perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    duration = 0; simulationStartTimeMs = 0;
    activeLines = [];

    perfectCountElement.textContent = '0'; greatCountElement.textContent = '0';
    goodCountElement.textContent = '0'; missCountElement.textContent = '0';
    currentTimeElement.textContent = '0.000'; totalDurationElement.textContent = '0.00';
    currentComboElement.textContent = '0'; maxComboElement.textContent = '0';
    songTitleElement.textContent = 'N/A'; songArtistElement.textContent = 'N/A';
    songDifficultyElement.textContent = 'N/A'; songRatingElement.textContent = 'N/A';

    displayElement.style.display = 'none';
    visualizerWrapper.style.display = 'none';
    if (ctx) drawVisualizerBackground();

    startButton.disabled = true;
}

/**
 * Resets everything, including wiping the list of loaded replays.
 */
function resetAll(isInitial = false) {
    resetCurrentReplayState();
    allReplaysData = null;
    replaySelectorContainer.innerHTML = '';
    replaySelectorContainer.style.display = 'none';

    uploadButton.disabled = false;
    fileUploadInput.disabled = false;

    if (isInitial) {
        updateStatus('Please select a replay file (.zip or .scp) and click "Upload & Process".');
    } else {
        updateStatus('State reset. Select a file or upload again.');
    }
}

uploadButton.addEventListener('click', async () => {
    const file = fileUploadInput.files[0];
    if (!file) {
        updateStatus('No file selected. Please select a .zip or .scp file.', true);
        return;
    }
    const allowedTypes = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    const allowedExtensions = ['.zip', '.scp'];
    const fileExtension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

    if (!allowedExtensions.includes(fileExtension) && !allowedTypes.includes(file.type)) {
        console.warn(`File type: ${file.type}, File extension: ${fileExtension}`);
        updateStatus(`Invalid file type. Please select a .zip or .scp file. (Type: ${file.type || 'unknown'})`, true);
        return;
    }

    resetAll();
    updateStatus(`Uploading "${file.name}"...`);
    uploadButton.disabled = true;
    fileUploadInput.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(BACKEND_UPLOAD_URL, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            let errorMsg = `Upload failed: ${response.status} ${response.statusText}`;
            try { const errorData = await response.json(); errorMsg += ` - ${errorData.detail || JSON.stringify(errorData)}`; }
            catch (e) { /* ignore */ }
            throw new Error(errorMsg);
        }

        allReplaysData = await response.json();
        console.log("Backend response (all replays):", allReplaysData);

        if (typeof allReplaysData !== 'object' || allReplaysData === null || Object.keys(allReplaysData).length === 0) {
            throw new Error("Invalid or empty response structure from backend. Expected a dictionary of replays.");
        }

        let hasValidReplay = false;
        for (const key in allReplaysData) {
            if (allReplaysData[key] && !allReplaysData[key].error) {
                hasValidReplay = true;
                break;
            }
        }
        if (!hasValidReplay) {
            const firstErrorKey = Object.keys(allReplaysData)[0];
            const errorDetail = allReplaysData[firstErrorKey]?.error || "Unknown processing error for all items.";
            throw new Error(`All replay items in the archive failed to process. First error: ${errorDetail}`);
        }

        populateReplaySelector(allReplaysData);
        replaySelectorContainer.style.display = 'block';
        updateStatus(`Archive processed. Please select a replay to view.`);


    } catch (error) {
        updateStatus(`Error: ${error.message}`, true);
        console.error("Upload or initial processing error:", error);
        resetAll();
    } finally {
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
    }
});

function populateReplaySelector(replays) {
    replaySelectorContainer.innerHTML = '';

    const selectLabel = document.createElement('label');
    selectLabel.htmlFor = 'replay-select-dropdown';
    selectLabel.textContent = 'Select Replay: ';
    replaySelectorContainer.appendChild(selectLabel);

    const select = document.createElement('select');
    select.id = 'replay-select-dropdown';

    const defaultOption = document.createElement('option');
    defaultOption.value = "";
    defaultOption.textContent = "-- Choose a replay --";
    defaultOption.disabled = true;
    defaultOption.selected = true;
    select.appendChild(defaultOption);

    for (const replayKey in replays) {
        const replayItem = replays[replayKey];
        if (replayItem && !replayItem.error) {
            const option = document.createElement('option');
            option.value = replayKey;
            const displayName = replayItem.metadata?.title || replayKey;
            option.textContent = displayName;
            select.appendChild(option);
        } else if (replayItem && replayItem.error) {
            console.warn(`Skipping replay item ${replayKey} due to error: ${replayItem.error}`);
            const errorOption = document.createElement('option');
            errorOption.value = replayKey;
            errorOption.textContent = `(Error) ${replayKey.split('.')[0]}: ${replayItem.error.substring(0,30)}...`;
            errorOption.disabled = true;
        }
    }

    select.addEventListener('change', (event) => {
        const selectedKey = event.target.value;
        if (selectedKey && allReplaysData[selectedKey] && !allReplaysData[selectedKey].error) {
            loadSelectedReplayData(selectedKey);
        } else {
            resetCurrentReplayState();
            updateStatus("Please select a valid replay.", true);
        }
    });

    replaySelectorContainer.appendChild(select);
}

function loadSelectedReplayData(replayKey) {
    resetCurrentReplayState();
    currentReplayKey = replayKey;
    currentReplayData = allReplaysData[replayKey];

    if (!currentReplayData || !currentReplayData.replay || !currentReplayData.replay.inputs || currentReplayData.replay.duration == null) {
        updateStatus(`Error: Invalid data structure for selected replay "${replayKey}". Missing required fields.`, true);
        console.error("Invalid data for selected replay:", currentReplayData);
        startButton.disabled = true;
        return;
    }
    updateStatus(`Processing selected replay: "${currentReplayData.metadata?.title || replayKey}"...`);

    const replay = currentReplayData.replay;
    const inputs = replay.inputs;
    duration = replay.duration;

    if (!inputs.time || !inputs.judgment || !inputs.accuracy) {
        updateStatus(`Error: Selected replay "${replayKey}" missing time, judgment, or accuracy arrays.`, true);
        startButton.disabled = true;
        return;
    }

    const decodedTimes = decodeDelta(inputs.time);
    if (!decodedTimes) {
        updateStatus(`Error: Failed to decode delta times for replay "${replayKey}".`, true);
        startButton.disabled = true;
        return;
    }

    const judgments = inputs.judgment;
    const accuracies = inputs.accuracy;

    let minLen = Math.min(decodedTimes.length, judgments.length, accuracies.length);
    if (decodedTimes.length !== judgments.length || decodedTimes.length !== accuracies.length) {
        const lenMsg = `Mismatched lengths for "${replayKey}"! T:${decodedTimes.length}, J:${judgments.length}, A:${accuracies.length}. Truncating to ${minLen}.`;
        console.warn(lenMsg); updateStatus(`Warning: ${lenMsg}`, false);
        if (minLen === 0) {
            updateStatus(`Error: No consistent events after truncation for "${replayKey}".`, true);
            startButton.disabled = true; return;
        }
    }
    const truncatedTimes = decodedTimes.slice(0, minLen);
    const truncatedJudgments = judgments.slice(0, minLen);
    const truncatedAccuracies = accuracies.slice(0, minLen);
    processedInputs = truncatedTimes.map((time, i) => ({ index: i, time: time, judgment: truncatedJudgments[i], accuracy: truncatedAccuracies[i] }));


    if (processedInputs.length === 0) {
        updateStatus(`Error: No input events to process for replay "${replayKey}".`, true);
        startButton.disabled = true; return;
    }
    processedInputs.sort((a, b) => a.time - b.time);

    const metadata = currentReplayData.metadata;
    if (metadata) {
        songTitleElement.textContent = metadata.title || 'N/A';
        songArtistElement.textContent = Array.isArray(metadata.mod) ? metadata.mod.join(', ') : (metadata.mod || 'NO-MOD');
        songDifficultyElement.textContent = metadata.difficulty || 'N/A';
        songRatingElement.textContent = metadata.rating != null ? metadata.rating : 'N/A';
    }

    totalDurationElement.textContent = duration.toFixed(2);
    displayElement.style.display = 'block';
    visualizerWrapper.style.display = 'block';
    drawVisualizerBackground();

    startButton.disabled = false;
    updateStatus(`Replay "${metadata?.title || replayKey}" loaded. Ready to start simulation.`);
}


startButton.addEventListener('click', () => {
    if (!currentReplayData || !processedInputs || processedInputs.length === 0 || simulationRunning) {
        console.warn("Cannot start simulation: No replay selected/processed, or already running.");
        return;
    }

    nextEventIndex = 0; combo = 0; maxCombo = 0;
    perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    activeLines = [];

    perfectCountElement.textContent = '0'; greatCountElement.textContent = '0';
    goodCountElement.textContent = '0'; missCountElement.textContent = '0';
    currentComboElement.textContent = '0'; maxComboElement.textContent = '0';
    currentTimeElement.textContent = '0.000';
    drawVisualizerBackground();

    simulationRunning = true;
    startButton.disabled = true;
    uploadButton.disabled = true;
    fileUploadInput.disabled = true;
    document.getElementById('replay-select-dropdown').disabled = true;

    updateStatus(`Simulation running for "${currentReplayData.metadata?.title || currentReplayKey}"...`);

    simulationStartTimeMs = performance.now();
    animationFrameId = requestAnimationFrame(simulationStep);
});

function simulationStep(timestamp) {
    if (!simulationRunning) return;
    const now = performance.now();
    const elapsedMs = now - simulationStartTimeMs;
    const currentReplayTime = elapsedMs / 1000.0;
    currentTimeElement.textContent = currentReplayTime.toFixed(3);

    while (nextEventIndex < processedInputs.length && processedInputs[nextEventIndex].time <= currentReplayTime) {
        const event = processedInputs[nextEventIndex];
        const judgVal = event.judgment; const accuracy = event.accuracy;
        switch (judgVal) {
            case 0: combo = 0; missCount++; missCountElement.textContent = missCount; break;
            case 1: combo++; perfectCount++; perfectCountElement.textContent = perfectCount; break;
            case 2: combo++; greatCount++; greatCountElement.textContent = greatCount; break;
            case 3: combo = 0; goodCount++; goodCountElement.textContent = goodCount; break;
        }
        maxCombo = Math.max(maxCombo, combo);
        currentComboElement.textContent = combo; maxComboElement.textContent = maxCombo;
        const xPos = mapAccuracyToX(accuracy, canvas.width, VISUALIZER_ACCURACY_RANGE);
        const vizColor = judgmentVizColorMap[judgVal] ?? judgmentVizColorMap.default;
        activeLines.push({ x: xPos, color: vizColor, addedTime: now, judgment: judgVal });
        nextEventIndex++;
    }

    drawVisualizerBackground();
    const remainingLines = [];
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;

    for (const line of activeLines) {
        const age = now - line.addedTime;
        if (age < LINE_FADE_DURATION_MS) {
            const opacity = Math.max(0, 1.0 - (age / LINE_FADE_DURATION_MS));
            ctx.globalAlpha = opacity;
            ctx.strokeStyle = line.color;

            if (line.judgment === 1) {
                ctx.lineWidth = 4;
                ctx.shadowColor = line.color;
                ctx.shadowBlur = 5;
            } else if (line.judgment === 0) {
                ctx.lineWidth = 2;
                ctx.shadowBlur = 0;
            } else {
                ctx.lineWidth = 2;
                ctx.shadowBlur = 0;
            }

            ctx.beginPath();
            ctx.moveTo(line.x, 0);
            ctx.lineTo(line.x, canvas.height);
            ctx.stroke();
            remainingLines.push(line);
        }
    }
    activeLines = remainingLines;
    ctx.globalAlpha = 1.0;
    ctx.shadowBlur = 0;

    const buffer = 0.1;
    if (currentReplayTime >= (duration + buffer) && nextEventIndex >= processedInputs.length) {
        simulationRunning = false;
        updateStatus(`Simulation finished for "${currentReplayData.metadata?.title || currentReplayKey}". Final Max Combo: ${maxCombo}.`);
        startButton.disabled = true;
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
        document.getElementById('replay-select-dropdown').disabled = false;
        currentTimeElement.textContent = duration.toFixed(3);
    } else {
        animationFrameId = requestAnimationFrame(simulationStep);
    }
}

resetAll(true);