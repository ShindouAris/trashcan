const fileUploadInput = document.getElementById('replayUploadFile');
const uploadButton = document.getElementById('uploadButton');
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status').querySelector('p');
const displayElement = document.getElementById('display');

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

const BACKEND_UPLOAD_URL = 'http://40.76.122.0:8000/replayv1';


let fullBackendData = null; // Store the entire response
let processedInputs = [];
let simulationRunning = false;
let animationFrameId = null;
let simulationStartTimeMs = 0;
let nextEventIndex = 0;
let combo = 0; maxCombo = 0;
let perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
let duration = 0;
let activeLines = [];
const judgmentVizColorMap = { 0: "#e74c3c", 1: "#00a6ff", 2: "#3498db", 3: "#f1c40f", default: "#95a5a6" };

const VISUALIZER_ACCURACY_RANGE = 0.15;

const ACCURACY_THRESHOLDS = {
    PERFECT: 0.043,
    GREAT:   0.083,
    GOOD:    0.128,
    MISS:   0.130
};

const ACCURACY_BAR_COLORS = {
    PERFECT: "#b7ecec",
    GREAT:   "#90EE90",
    GOOD:    "#FFD700",
    MISS:    "#FF0000"
};

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
    if (canvas.width !== canvas.clientWidth) {
        canvas.width = canvas.clientWidth;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000'; // Black background, as in the image
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const maxDisplayTimeOffset = VISUALIZER_ACCURACY_RANGE;

    ctx.fillStyle = ACCURACY_BAR_COLORS.MISS;
    let x_start_miss = mapAccuracyToX(-maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
    let x_end_miss = mapAccuracyToX(maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
    ctx.fillRect(x_start_miss, 0, x_end_miss - x_start_miss, canvasHeight);

    ctx.fillStyle = ACCURACY_BAR_COLORS.GOOD;
    let x_start_good = mapAccuracyToX(-maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
    let x_end_good = mapAccuracyToX(maxDisplayTimeOffset, canvasWidth, maxDisplayTimeOffset);
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
 * Resets all simulation state and UI elements.
 */
function resetSimulation(isInitial = false) {
    if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
    simulationRunning = false;
    fullBackendData = null;
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


    resetSimulation();
    updateStatus(`Uploading "${file.name}"...`);
    uploadButton.disabled = true;
    fileUploadInput.disabled = true;
    startButton.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(BACKEND_UPLOAD_URL, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            let errorMsg = `Upload failed with status: ${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMsg += ` - ${errorData.message || JSON.stringify(errorData)}`;
            } catch (e) {  }
            throw new Error(errorMsg);
        }

        fullBackendData = await response.json();
        updateStatus('Processing response...');
        console.log("Backend response received:", fullBackendData);


        if (!fullBackendData || !fullBackendData.replay || !fullBackendData.replay.inputs || !fullBackendData.replay.duration) {
            throw new Error("Invalid response structure from backend. Missing required replay data.");
        }

        const replay = fullBackendData.replay;
        const inputs = replay.inputs;
        duration = replay.duration;

        if (!inputs.time || !inputs.judgment || !inputs.accuracy) {
            throw new Error("Backend response missing time, judgment, or accuracy arrays in replay.inputs.");
        }

        const decodedTimes = decodeDelta(inputs.time);
        if (!decodedTimes) {
            throw new Error("Failed to decode delta times.");
        }

        const judgments = inputs.judgment;
        const accuracies = inputs.accuracy;

        let minLen = Math.min(decodedTimes.length, judgments.length, accuracies.length);
        if (decodedTimes.length !== judgments.length || decodedTimes.length !== accuracies.length) {
            const lenMsg = `Mismatched lengths after processing! T:${decodedTimes.length}, J:${judgments.length}, A:${accuracies.length}. Truncating to ${minLen}.`;
            console.warn(lenMsg); updateStatus(`Warning: ${lenMsg}`, false);
            if (minLen === 0) { throw new Error("No consistent events after truncation."); }
            const truncatedTimes = decodedTimes.slice(0, minLen);
            const truncatedJudgments = judgments.slice(0, minLen);
            const truncatedAccuracies = accuracies.slice(0, minLen);
            processedInputs = truncatedTimes.map((time, i) => ({ index: i, time: time, judgment: truncatedJudgments[i], accuracy: truncatedAccuracies[i] }));
        } else {
            processedInputs = decodedTimes.map((time, i) => ({ index: i, time: time, judgment: judgments[i], accuracy: accuracies[i] }));
        }

        if (processedInputs.length === 0) { throw new Error("No input events to process."); }
        processedInputs.sort((a, b) => a.time - b.time);

        const metadata = fullBackendData.metadata;
        if (metadata) {
            songTitleElement.textContent = metadata.title || 'N/A';
            songArtistElement.textContent = metadata.mod || 'NO-MOD';
            songDifficultyElement.textContent = metadata.difficulty || 'N/A';
            songRatingElement.textContent = metadata.rating != null ? metadata.rating : 'N/A';
        }

        totalDurationElement.textContent = duration.toFixed(2);
        displayElement.style.display = 'block';
        visualizerWrapper.style.display = 'block';
        drawVisualizerBackground();

        startButton.disabled = false;
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
        updateStatus(`Replay data processed successfully for "${metadata?.title || file.name}". Ready to start simulation.`);


    } catch (error) {
        updateStatus(`Error: ${error.message}`, true);
        console.error("Upload or processing error:", error);
        resetSimulation();
        uploadButton.disabled = false;
        fileUploadInput.disabled = false;
        startButton.disabled = true;
    }
});

startButton.addEventListener('click', () => {
    if (!processedInputs || processedInputs.length === 0 || simulationRunning) {
        console.warn("Cannot start simulation: No processed data, or already running.");
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
    updateStatus(`Simulation running...`);

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
        const judgVal = event.judgment; const accuracy = event.accuracy; const eventTime = event.time;
        switch (judgVal) {
            case 0: combo = 0; missCount++; missCountElement.textContent = missCount; break;
            case 1: combo++; perfectCount++; perfectCountElement.textContent = perfectCount; break;
            case 2: combo++; greatCount++; greatCountElement.textContent = greatCount; break;
            case 3: combo = 0; goodCount++; goodCountElement.textContent = goodCount; break; // Good breaks combo in some games
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
            }
            else if (line.judgment === 5) {
                ctx.lineWidth = 3;
                ctx.shadowColor = line.color;
                ctx.shadowBlur = 3;
            }
            else {
                ctx.lineWidth = 2;
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
        updateStatus(`Simulation finished. Final Max Combo: ${maxCombo}. Select another file or upload again.`);
        startButton.disabled = true;
        uploadButton.disabled = false; fileUploadInput.disabled = false;
        currentTimeElement.textContent = duration.toFixed(3);
    } else {
        animationFrameId = requestAnimationFrame(simulationStep);
    }
}

resetSimulation(true);