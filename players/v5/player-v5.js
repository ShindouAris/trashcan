const fileUploadInput = document.getElementById('replayUploadFile');
const uploadButton = document.getElementById('uploadButton');
const startButton = document.getElementById('startButton');
const startButtonText = document.getElementById('startButtonText');

const statusCard = document.getElementById('statusCard');
const statusTextElement = document.getElementById('statusTextElement');
const statusIconElement = document.getElementById('statusIconElement');

const displaySection = document.getElementById('displaySection');
const replaySelectorCard = document.getElementById('replaySelectorCard');
const replaySelectorContainer = document.getElementById('replaySelectorContainer');

const songTitleDisplay = document.getElementById('songTitleDisplay');
const songModsDisplay = document.getElementById('songModsDisplay');
const songDifficultyDisplay = document.getElementById('songDifficultyDisplay');
const songRatingDisplay = document.getElementById('songRatingDisplay');
const totalEventsDisplay = document.getElementById('totalEventsDisplay');

const perfectCountDisplay = document.getElementById('perfectCountDisplay');
const greatCountDisplay = document.getElementById('greatCountDisplay');
const goodCountDisplay = document.getElementById('goodCountDisplay');
const missCountDisplay = document.getElementById('missCountDisplay');

const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const totalDurationDisplay = document.getElementById('totalDurationDisplay');
const currentComboDisplay = document.getElementById('currentComboDisplay');
const maxComboDisplay = document.getElementById('maxComboDisplay');

const visualizerContainer = document.getElementById('visualizerContainer');
const canvas = document.getElementById('accuracyVisualizerCanvas');
const ctx = canvas.getContext('2d');

const fileNameDisplayElement = document.getElementById('fileNameDisplay');
const fileSizeDisplayElement = document.getElementById('fileSizeDisplay');

const BACKEND_UPLOAD_URL = 'http://192.168.1.8:8000/replayv2';

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

const judgmentVizColorMap = { 0: "#ef4444", 1: "#1073b9", 2: "#79f63b", 3: "#f59e0b", default: "#9ca3af" };
const VISUALIZER_ACCURACY_RANGE = 0.15;
const ACCURACY_THRESHOLDS = { PERFECT: 0.043, GREAT: 0.083, GOOD: 0.128, MISS: 0.130 };
const ACCURACY_BAR_COLORS = {
    PERFECT: "rgba(16,115,185,0.8)",
    GREAT:   "rgba(71,246,59,0.7)",
    GOOD:    "rgba(245,190,11,0.6)",
    MISS:    "rgba(239, 68, 68, 0.5)"
};
const LINE_FADE_DURATION_MS = 2000;

function decodeDelta(deltaArray) {
    if (!Array.isArray(deltaArray)) {
        console.warn(`Invalid delta time format.`);
        updateStatus(`Error: Invalid delta time format in replay.`, true);
        return null;
    }
    const decoded = [];
    let currentValue = 0.0;
    for (const delta of deltaArray) {
        const deltaVal = parseFloat(delta);
        if (isNaN(deltaVal)) {
            console.warn(`Skipping non-float delta: '${delta}'`);
            continue;
        }
        currentValue += deltaVal;
        decoded.push(currentValue);
    }
    return decoded;
}

function updateStatus(message, isError = false) {
    statusTextElement.textContent = message;
    if (isError) {
        statusCard.classList.add('error');
        statusIconElement.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:1.25em; height:1.25em;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>`;
    } else {
        statusCard.classList.remove('error');
        statusIconElement.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:1.25em; height:1.25em;"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>`;
    }
    statusCard.style.display = 'flex';
    console.log(message);
}

function mapAccuracyToX(accuracy, canvasWidth, maxAbsAccuracy) {
    const normalized = (accuracy + maxAbsAccuracy) / (2 * maxAbsAccuracy);
    const clamped = Math.max(0, Math.min(1, normalized));
    return clamped * canvasWidth;
}

function drawVisualizerBackground() {
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4b5563';
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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}


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

    perfectCountDisplay.textContent = '0'; greatCountDisplay.textContent = '0';
    goodCountDisplay.textContent = '0'; missCountDisplay.textContent = '0';
    currentTimeDisplay.textContent = '0.000'; totalDurationDisplay.textContent = '0.00';
    currentComboDisplay.textContent = '0'; maxComboDisplay.textContent = '0';
    songTitleDisplay.textContent = 'N/A'; songModsDisplay.textContent = 'N/A';
    songDifficultyDisplay.textContent = 'N/A'; songRatingDisplay.textContent = 'N/A';
    totalEventsDisplay.textContent = '0';

    displaySection.style.display = 'none';
    if (ctx) drawVisualizerBackground();

    startButton.disabled = true;
    startButtonText.textContent = 'Start Simulation';
}

function resetAll(isInitial = false) {
    resetCurrentReplayState();
    allReplaysData = null;
    replaySelectorContainer.innerHTML = '';
    replaySelectorCard.style.display = 'none';

    fileNameDisplayElement.textContent = 'No file selected';
    fileSizeDisplayElement.textContent = 'N/A';
    fileUploadInput.value = '';

    uploadButton.disabled = false;
    fileUploadInput.disabled = false;

    if (isInitial) {
        updateStatus('Please select a replay file (.zip or .scp) and click "Upload & Process".');
    } else {
        statusCard.style.display = 'none';
    }
}

fileUploadInput.addEventListener('change', function() {
    if (this.files && this.files[0]) {
        const file = this.files[0];
        fileNameDisplayElement.textContent = file.name;
        fileSizeDisplayElement.textContent = (file.size / 1024).toFixed(1) + ' KB';

        if (currentReplayKey || allReplaysData) {
            resetCurrentReplayState();
            replaySelectorContainer.innerHTML = '';
            replaySelectorCard.style.display = 'none';
            allReplaysData = null;
        }
        displaySection.style.display = 'none';
        startButton.disabled = true;

        updateStatus(`File "${file.name}" selected. Click "Upload & Process" to continue.`);
        uploadButton.disabled = false;
    } else {
        fileNameDisplayElement.textContent = 'No file selected';
        fileSizeDisplayElement.textContent = 'N/A';
        if (!allReplaysData) {
            updateStatus('No file selected. Please select a replay file.');
        }
    }
});

uploadButton.addEventListener('click', async () => {
    const file = fileUploadInput.files[0];
    if (!file) {
        updateStatus('No file selected. Please select a .zip or .scp file.', true);
        return;
    }

    const allowedExtensions = ['.zip', '.scp'];
    const fileExtension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
        updateStatus(`Invalid file type. Please select a .zip or .scp file.`, true);
        return;
    }

    resetAll();
    updateStatus(`Uploading "${file.name}"...`);
    uploadButton.disabled = true;
    fileUploadInput.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(BACKEND_UPLOAD_URL, { method: 'POST', body: formData });

        if (!response.ok) {
            let errorMsg = `Upload failed: ${response.status} ${response.statusText}`;
            try { const errorData = await response.json(); errorMsg += ` - ${errorData.detail || JSON.stringify(errorData)}`; }
            catch (e) { /* ignore */ }
            throw new Error(errorMsg);
        }

        allReplaysData = await response.json();
        console.log("Backend response (all replays):", allReplaysData);

        if (typeof allReplaysData !== 'object' || allReplaysData === null || Object.keys(allReplaysData).length === 0) {
            throw new Error("Invalid or empty response from backend. Expected a collection of replays.");
        }

        let hasValidReplay = false;
        for (const key in allReplaysData) {
            if (allReplaysData[key] && !allReplaysData[key].error) { hasValidReplay = true; break; }
        }
        if (!hasValidReplay) {
            const firstErrorKey = Object.keys(allReplaysData)[0];
            const errorDetail = allReplaysData[firstErrorKey]?.error || "All items failed processing.";
            throw new Error(`No valid replays found in archive. First error: ${errorDetail}`);
        }

        populateReplaySelector(allReplaysData);
        updateStatus(`Archive processed. Please select a replay to view.`);

    } catch (error) {
        if (error.message.includes("Failed to fetch")) {
            updateStatus("Network error: Unable to reach the server. Please check your connection.", true);
        }
        else {
            updateStatus(`Error: ${error.message}`, true);
        }
        console.error("Upload or initial processing error:", error);
    } finally {
        // resetAll();
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
    }
});

function populateReplaySelector(replays) {
    replaySelectorContainer.innerHTML = '';
    let firstValidKey = null;
    let hasItems = false;

    for (const replayKey in replays) {
        hasItems = true;
        const replayItemData = replays[replayKey];
        const itemDiv = document.createElement('div');
        itemDiv.className = 'replay-item';
        itemDiv.dataset.replayKey = replayKey;

        const iconPlaceholder = document.createElement('div');
        iconPlaceholder.className = 'replay-item-icon-placeholder';

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'replay-item-details';

        const titleH3 = document.createElement('h3');
        titleH3.className = 'replay-title';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'replay-meta';

        if (replayItemData && replayItemData.error) {
            itemDiv.classList.add('error-item');
            iconPlaceholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="replay-svg-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>`;
            titleH3.textContent = `${replayKey} (Error)`;
            metaDiv.innerHTML = `<span>${replayItemData.error.substring(0, 60)}...</span>`;
        } else if (replayItemData && replayItemData.metadata && replayItemData.replay) {
            if (!firstValidKey) firstValidKey = replayKey;
            const metadata = replayItemData.metadata;
            const mods = Array.isArray(metadata.mod) ? metadata.mod.join(', ') : (metadata.mod || 'NO-MOD');
            iconPlaceholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="replay-svg-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>`;
            titleH3.textContent = metadata.title || replayKey;
            metaDiv.innerHTML = `
                <span>Mod: <strong class="mod-list">${mods}</strong></span>
                <span>Difficulty: <strong class="difficulty-val">${metadata.difficulty || 'N/A'}</strong></span>
                <span>Rating: <strong class="rating-val">${metadata.rating != null ? metadata.rating : 'N/A'}</strong></span>`;

            itemDiv.addEventListener('click', () => {
                replaySelectorContainer.querySelectorAll('.replay-item.selected-replay').forEach(el => el.classList.remove('selected-replay'));
                itemDiv.classList.add('selected-replay');
                loadSelectedReplayData(replayKey);
            });
        } else {
            itemDiv.classList.add('error-item');
            iconPlaceholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="replay-svg-icon"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></svg>`; // Question mark icon
            titleH3.textContent = `${replayKey} (Invalid Data)`;
            metaDiv.innerHTML = `<span>Replay data is malformed.</span>`;
        }

        detailsDiv.appendChild(titleH3);
        detailsDiv.appendChild(metaDiv);
        itemDiv.appendChild(iconPlaceholder);
        itemDiv.appendChild(detailsDiv);
        replaySelectorContainer.appendChild(itemDiv);
    }
    replaySelectorCard.style.display = hasItems ? 'block' : 'none';

    if (firstValidKey) {
        const firstItemElement = replaySelectorContainer.querySelector(`.replay-item[data-replay-key="${firstValidKey}"]`);
        if (firstItemElement) firstItemElement.click();
    } else if (hasItems) {
        updateStatus("All replay items in the archive have errors or are unreadable.", true);
    }
}


function loadSelectedReplayData(replayKey) {
    resetCurrentReplayState();
    currentReplayKey = replayKey;
    currentReplayData = allReplaysData[replayKey];

    if (!currentReplayData || !currentReplayData.replay || !currentReplayData.replay.inputs || currentReplayData.replay.duration == null) {
        updateStatus(`Error: Invalid data for selected replay "${replayKey}".`, true);
        return;
    }
    updateStatus(`Processing: "${currentReplayData.metadata?.title || replayKey}"...`);

    const replay = currentReplayData.replay;
    const inputs = replay.inputs;
    duration = parseFloat(replay.duration);

    if (!inputs.time || !inputs.judgment || !inputs.accuracy) {
        updateStatus(`Error: Replay "${replayKey}" missing time, judgment, or accuracy.", true`);
        return;
    }

    const decodedTimes = decodeDelta(inputs.time);
    if (decodedTimes === null) {
        // updateStatus already called by decodeDelta
        return;
    }

    const judgments = inputs.judgment;
    const accuracies = inputs.accuracy;
    let minLen = Math.min(decodedTimes.length, judgments.length, accuracies.length);

    if (decodedTimes.length !== judgments.length || decodedTimes.length !== accuracies.length) {
        const lenMsg = `Data array length mismatch for "${replayKey}"! T:${decodedTimes.length}, J:${judgments.length}, A:${accuracies.length}. Truncating to ${minLen}.`;
        console.warn(lenMsg);
        if (minLen === 0) {
            updateStatus(`Error: No consistent event data after truncation for "${replayKey}".`, true);
            return;
        }
    }

    processedInputs = decodedTimes.slice(0, minLen).map((time, i) => ({
        index: i, time: time, judgment: judgments[i], accuracy: accuracies[i]
    }));

    if (processedInputs.length === 0 && minLen > 0) {
        updateStatus(`Error: No input events after processing for "${replayKey}".`, true);
        return;
    }
    const metadata = currentReplayData.metadata;
    if (metadata) {
        songTitleDisplay.textContent = metadata.title || 'N/A';
        songModsDisplay.textContent = Array.isArray(metadata.mod) ? metadata.mod.join(', ') : (metadata.mod || 'NO-MOD');
        songDifficultyDisplay.textContent = metadata.difficulty || 'N/A';
        songRatingDisplay.textContent = metadata.rating != null ? metadata.rating : 'N/A';
    }
    totalEventsDisplay.textContent = processedInputs.length;
    totalDurationDisplay.textContent = duration.toFixed(2);

    displaySection.style.display = 'block';
    drawVisualizerBackground();

    startButton.disabled = processedInputs.length === 0;
    if (processedInputs.length > 0) {
        updateStatus(`Replay "${metadata?.title || replayKey}" loaded. Ready to start simulation.`);
    } else {
        updateStatus(`Replay "${metadata?.title || replayKey}" loaded, but has no events. Cannot simulate.`, true);
    }
}


startButton.addEventListener('click', () => {
    if (!currentReplayData || !processedInputs || processedInputs.length === 0 || simulationRunning) {
        console.warn("Cannot start: No replay selected/processed, or already running, or no events.");
        return;
    }

    nextEventIndex = 0; combo = 0; maxCombo = 0;
    perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    activeLines = [];

    perfectCountDisplay.textContent = '0'; greatCountDisplay.textContent = '0';
    goodCountDisplay.textContent = '0'; missCountDisplay.textContent = '0';
    currentComboDisplay.textContent = '0';
    currentTimeDisplay.textContent = '0.000';
    drawVisualizerBackground();

    simulationRunning = true;
    startButton.disabled = true;
    startButtonText.textContent = 'Simulating...';
    uploadButton.disabled = true;
    fileUploadInput.disabled = true;
    replaySelectorContainer.querySelectorAll('.replay-item').forEach(item => item.style.pointerEvents = 'none');

    updateStatus(`Simulating: "${currentReplayData.metadata?.title || currentReplayKey}"...`);
    simulationStartTimeMs = performance.now();
    animationFrameId = requestAnimationFrame(simulationStep);
});


function simulationStep(timestamp) {
    if (!simulationRunning) return;
    const now = performance.now();
    const elapsedMs = now - simulationStartTimeMs;
    const currentReplayTime = elapsedMs / 1000.0;
    currentTimeDisplay.textContent = currentReplayTime.toFixed(3);

    while (nextEventIndex < processedInputs.length && processedInputs[nextEventIndex].time <= currentReplayTime) {
        const event = processedInputs[nextEventIndex];
        const judgVal = event.judgment; const accuracy = event.accuracy;
        switch (judgVal) {
            case 0: combo = 0; missCount++; missCountDisplay.textContent = missCount; break;
            case 1: combo++; perfectCount++; perfectCountDisplay.textContent = perfectCount; break;
            case 2: combo++; greatCount++; greatCountDisplay.textContent = greatCount; break;
            case 3: combo = 0; goodCount++; goodCountDisplay.textContent = goodCount; break;
        }
        if (combo > maxCombo) maxCombo = combo;
        currentComboDisplay.textContent = combo;
        maxComboDisplay.textContent = maxCombo;

        const xPos = mapAccuracyToX(accuracy, canvas.width, VISUALIZER_ACCURACY_RANGE);
        const vizColor = judgmentVizColorMap[judgVal] ?? judgmentVizColorMap.default;
        activeLines.push({ x: xPos, color: vizColor, addedTime: now, judgment: judgVal });
        nextEventIndex++;
    }

    drawVisualizerBackground();
    const remainingLines = [];
    ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;

    for (const line of activeLines) {
        const age = now - line.addedTime;
        if (age < LINE_FADE_DURATION_MS) {
            const opacity = Math.max(0, 1.0 - (age / LINE_FADE_DURATION_MS));
            ctx.globalAlpha = opacity * 0.8;
            ctx.strokeStyle = line.color;

            if (line.judgment === 1) {
                ctx.lineWidth = 2.5;
                ctx.shadowColor = line.color;
                ctx.shadowBlur = 6;
            } else if (line.judgment === 0) {
                ctx.lineWidth = 1.5;
            } else {
                ctx.lineWidth = 2;
            }
            ctx.beginPath(); ctx.moveTo(line.x, 0); ctx.lineTo(line.x, canvas.height); ctx.stroke();
            remainingLines.push(line);
        }
    }
    activeLines = remainingLines;
    ctx.globalAlpha = 1.0; ctx.shadowBlur = 0;

    const buffer = 0.2;
    if (currentReplayTime >= (duration + buffer) || (currentReplayTime > duration && nextEventIndex >= processedInputs.length)) {
        simulationRunning = false;
        updateStatus(`Simulation finished for "${currentReplayData.metadata?.title || currentReplayKey}". Max Combo: ${maxCombo}.`);
        startButtonText.textContent = 'Finished';
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
        startButton.disabled = false;
        replaySelectorContainer.querySelectorAll('.replay-item').forEach(item => item.style.pointerEvents = 'auto');
        currentTimeDisplay.textContent = duration.toFixed(3);
        maxComboDisplay.textContent = maxCombo;
    } else {
        animationFrameId = requestAnimationFrame(simulationStep);
    }
}

resetAll(true);