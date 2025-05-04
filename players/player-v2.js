// --- DOM Elements ---
const fileInput = document.getElementById('replayFile');
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status').querySelector('p');
const displayElement = document.getElementById('display');
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

let replayData = null;
let processedInputs = [];
let simulationRunning = false;
let animationFrameId = null;
let simulationStartTimeMs = 0;
let nextEventIndex = 0;
let combo = 0;
let maxCombo = 0;
let perfectCount = 0;
let greatCount = 0;
let goodCount = 0;
let missCount = 0;
let duration = 0;

let activeLines = [];

const judgmentMap = { 0: "Miss", 1: "Perfect", 2: "Great", 3: "Good" };
const judgmentLogClassMap = { 0: "log-miss", 1: "log-perfect", 2: "log-great", 3: "log-good" };
const judgmentVizColorMap = {
    0: "#e74c3c",
    1: "#00FFFF",
    2: "#3498db",
    3: "#f1c40f",
    default: "#95a5a6"
};
const VISUALIZER_ACCURACY_RANGE = 0.15;
const LINE_FADE_DURATION_MS = 3000;


function decodeDelta(deltaArray) {
    if (!Array.isArray(deltaArray)) {
        console.warn(`Warning: decodeDelta received non-array input: ${typeof deltaArray}. Returning empty array.`);
        updateStatus(`Error: Invalid delta time format.`, true);
        return [];
    }
    const decoded = [];
    let currentValue = 0.0;
    for (const delta of deltaArray) {
        const deltaVal = parseFloat(delta);
        if (isNaN(deltaVal)) {
            console.warn(`Warning: Could not convert delta value '${delta}' to float in decodeDelta. Skipping.`);
            continue;
        }
        currentValue += deltaVal;
        decoded.push(currentValue);
    }
    return decoded;
}

function updateStatus(message, isError = false) {
    // (Implementation unchanged)
    statusElement.textContent = message;
    statusElement.style.color = isError ? 'red' : '#555';
    console.log(message);
}

function mapAccuracyToX(accuracy, canvasWidth, maxAbsAccuracy) {
    // (Implementation unchanged)
    const normalized = (accuracy + maxAbsAccuracy) / (2 * maxAbsAccuracy);
    const clamped = Math.max(0, Math.min(1, normalized));
    return clamped * canvasWidth;
}

/**
 * Draws the static background/elements of the visualizer.
 * Called at the start of each frame draw cycle.
 */
function drawVisualizerBackground() {
    if (canvas.width !== canvas.clientWidth) {
        canvas.width = canvas.clientWidth;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, canvas.height);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
}


/**
 * Resets all simulation state and UI elements.
 */
function resetSimulation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    simulationRunning = false;
    replayData = null;
    processedInputs = [];
    nextEventIndex = 0;
    combo = 0; maxCombo = 0;
    perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    duration = 0;
    simulationStartTimeMs = 0;
    activeLines = [];

    perfectCountElement.textContent = '0'; greatCountElement.textContent = '0';
    goodCountElement.textContent = '0'; missCountElement.textContent = '0';
    currentTimeElement.textContent = '0.000'; totalDurationElement.textContent = '0.00';
    currentComboElement.textContent = '0'; maxComboElement.textContent = '0';
    displayElement.style.display = 'none';
    visualizerWrapper.style.display = 'none';
    if (ctx) drawVisualizerBackground();

    startButton.disabled = true;
    fileInput.disabled = false;
    updateStatus('Please load a replay JSON file.');
}

fileInput.addEventListener('change', (event) => {
    resetSimulation();
    const file = event.target.files[0];
    if (!file) { updateStatus('No file selected.', true); return; }
    updateStatus(`Loading file: ${file.name}...`);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const fileContent = e.target.result;
            let rawData = JSON.parse(fileContent);
            if (!rawData) { throw new Error("No data found after parsing JSON."); }
            if (Array.isArray(rawData)) {
                if (rawData.length === 0) { throw new Error("JSON array is empty."); }
                if (rawData.length > 1) { console.warn(`Multiple replay objects found. Using first.`); }
                replayData = rawData[0];
            } else if (typeof rawData === 'object') {
                console.warn(`JSON root is object, not list. Using object directly.`);
                replayData = rawData;
            } else { throw new Error(`Unexpected JSON structure. Type: ${typeof rawData}`); }
            const inputs = replayData?.inputs;
            if (!inputs?.time) { throw new Error("Missing 'inputs' or 'inputs.time'"); }
            const decodedTimes = decodeDelta(inputs.time);
            if (!decodedTimes) return;
            if (inputs.judgment == null || inputs.accuracy == null) { throw new Error("Missing 'inputs.judgment' or 'inputs.accuracy'"); }
            if (replayData.duration == null) { throw new Error("Missing 'duration'"); }
            const judgments = inputs.judgment;
            const accuracies = inputs.accuracy;
            duration = replayData.duration;
            let minLen = Math.min(decodedTimes.length, judgments.length, accuracies.length);
            if (decodedTimes.length !== judgments.length || decodedTimes.length !== accuracies.length) {
                const lenMsg = `Mismatched lengths! T:${decodedTimes.length}, J:${judgments.length}, A:${accuracies.length}. Truncating to ${minLen}.`;
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

            totalDurationElement.textContent = duration.toFixed(2);
            displayElement.style.display = 'block';
            visualizerWrapper.style.display = 'block';
            drawVisualizerBackground();
            startButton.disabled = false;
            updateStatus(`Replay "${file.name}" loaded (${processedInputs.length} events). Ready.`);

        } catch (error) {
            updateStatus(`Error loading/parsing replay: ${error.message}`, true);
            console.error("File loading/parsing error:", error);
            resetSimulation();
        }
    };
    reader.onerror = (_) => { updateStatus(`Error reading file: ${reader.error}`, true); resetSimulation(); };
    reader.readAsText(file);
});

startButton.addEventListener('click', () => {
    if (!replayData || processedInputs.length === 0 || simulationRunning) return;

    nextEventIndex = 0; combo = 0; maxCombo = 0;
    perfectCount = 0; greatCount = 0; goodCount = 0; missCount = 0;
    activeLines = [];

    perfectCountElement.textContent = '0'; greatCountElement.textContent = '0';
    goodCountElement.textContent = '0'; missCountElement.textContent = '0';
    currentComboElement.textContent = '0'; maxComboElement.textContent = '0';
    currentTimeElement.textContent = '0.000';
    drawVisualizerBackground();

    simulationRunning = true;
    startButton.disabled = true; fileInput.disabled = true;
    updateStatus(`Simulation running... (Duration: ${duration.toFixed(2)}s)`);
    simulationStartTimeMs = performance.now();
    animationFrameId = requestAnimationFrame(simulationStep);
});

function simulationStep() {
    if (!simulationRunning) return;

    const now = performance.now();
    const elapsedMs = now - simulationStartTimeMs;
    const currentReplayTime = elapsedMs / 1000.0;

    currentTimeElement.textContent = currentReplayTime.toFixed(3);

    while (nextEventIndex < processedInputs.length &&
    processedInputs[nextEventIndex].time <= currentReplayTime) {

        const event = processedInputs[nextEventIndex];
        const judgVal = event.judgment;
        const accuracy = event.accuracy;
        const eventTime = event.time;

        switch (judgVal) {
            case 0: combo = 0; missCount++; missCountElement.textContent = missCount; break;
            case 1: combo++; perfectCount++; perfectCountElement.textContent = perfectCount; break;
            case 2: combo++; greatCount++; greatCountElement.textContent = greatCount; break;
            case 3: combo = 0; goodCount++; goodCountElement.textContent = goodCount; break;
        }
        maxCombo = Math.max(maxCombo, combo);
        currentComboElement.textContent = combo; maxComboElement.textContent = maxCombo;

        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry'); const judgmentText = judgmentMap[judgVal] ?? "Unknown";
        const logClass = judgmentLogClassMap[judgVal] ?? "log-unknown"; logEntry.classList.add(logClass);
        const timeStr = eventTime.toFixed(3).padStart(7); const accStr = (accuracy >= 0 ? '+' : '') + Number(accuracy).toFixed(4);
        logEntry.textContent = `T: ${timeStr}s - ${judgmentText} (Acc: ${accStr})`;

        const xPos = mapAccuracyToX(accuracy, canvas.width, VISUALIZER_ACCURACY_RANGE);
        const vizColor = judgmentVizColorMap[judgVal] ?? judgmentVizColorMap.default;
        activeLines.push({
            x: xPos,
            color: vizColor,
            addedTime: now
        });

        nextEventIndex++;
    }

    drawVisualizerBackground();

    const remainingLines = [];
    for (const line of activeLines) {
        const age = now - line.addedTime;

        if (age < LINE_FADE_DURATION_MS) {
            ctx.globalAlpha = Math.max(0, 1.0 - (age / LINE_FADE_DURATION_MS));
            ctx.strokeStyle = line.color;
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.moveTo(line.x, 0);
            ctx.lineTo(line.x, canvas.height);
            ctx.stroke();

            remainingLines.push(line);
        }

    }
    activeLines = remainingLines;

    ctx.globalAlpha = 1.0;


    const buffer = 0.1;
    if (currentReplayTime >= (duration + buffer) && nextEventIndex >= processedInputs.length) {
        simulationRunning = false;
        updateStatus(`Simulation finished. Final Max Combo: ${maxCombo}.`);
        startButton.disabled = false; fileInput.disabled = false;
        currentTimeElement.textContent = duration.toFixed(3);
    } else {
        animationFrameId = requestAnimationFrame(simulationStep);
    }
}

resetSimulation();