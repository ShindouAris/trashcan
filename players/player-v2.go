package main

import (
	"encoding/json"
	"fmt"
	"log"
	_ "math"
	"os"
	"sort"
	"strconv"
	"time"
)

type ReplayInputs struct {
	Time     []json.Number `json:"time"`
	Judgment []int         `json:"judgment"`
	Accuracy []float64     `json:"accuracy"`
}

type ReplayData struct {
	Inputs   ReplayInputs           `json:"inputs"`
	Duration float64                `json:"duration"`
	Result   map[string]interface{} `json:"result"`
}

type ProcessedEvent struct {
	Index    int
	Time     float64
	Judgment int
	Accuracy float64
}

func decodeDelta(deltaArray []json.Number) ([]float64, error) {
	decoded := make([]float64, 0, len(deltaArray))
	currentValue := 0.0
	for i, delta := range deltaArray {
		deltaVal, err := delta.Float64()
		if err != nil {
			deltaStr := delta.String()
			deltaVal, err = strconv.ParseFloat(deltaStr, 64)
			if err != nil {
				log.Printf("Warning: Could not convert delta value '%v' (index %d) to float in decodeDelta. Skipping. Error: %v", delta, i, err)
				continue // Skip this problematic delta
			}
		}

		currentValue += deltaVal
		decoded = append(decoded, currentValue)
	}
	return decoded, nil
}

func loadReplay(filepath string) (*ReplayData, error) {
	fileBytes, err := os.ReadFile(filepath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("error: Replay file '%s' not found", filepath)
		}
		return nil, fmt.Errorf("error reading file '%s': %w", filepath, err)
	}

	var replayDataList []ReplayData
	err = json.Unmarshal(fileBytes, &replayDataList)
	if err != nil {
		var singleReplayData ReplayData
		errSingle := json.Unmarshal(fileBytes, &singleReplayData)
		if errSingle == nil {
			log.Printf("Warning: JSON root is an object, not a list as expected. Using the object directly.")
			return &singleReplayData, nil
		}
		return nil, fmt.Errorf("error: Failed to parse JSON from '%s'. Details: %w", filepath, err)
	}

	if len(replayDataList) == 0 {
		log.Printf("Warning: No data found in %s", filepath)
		return nil, fmt.Errorf("no replay data objects found in the JSON list") // Return error for no data
	}

	if len(replayDataList) > 1 {
		log.Printf("Warning: Multiple replay objects found in %s. Using the first one.", filepath)
	}

	return &replayDataList[0], nil
}

func runViewer(replayData *ReplayData) {
	if replayData == nil {
		log.Println("Cannot run viewer, invalid replay data provided.")
		return
	}

	if replayData.Inputs.Time == nil {
		log.Println("Error: Replay data is missing 'inputs' or 'inputs.time'")
		return
	}
	decodedTimes, err := decodeDelta(replayData.Inputs.Time)
	if err != nil {

		log.Printf("Error decoding delta times: %v", err)
		// return
	}

	if replayData.Inputs.Judgment == nil || replayData.Inputs.Accuracy == nil {
		log.Println("Error: Replay data is missing 'inputs.judgment' or 'inputs.accuracy'")
		return
	}

	judgments := replayData.Inputs.Judgment
	accuracies := replayData.Inputs.Accuracy

	lenTimes := len(decodedTimes)
	lenJudg := len(judgments)
	lenAcc := len(accuracies)

	minLen := lenTimes
	if lenJudg < minLen {
		minLen = lenJudg
	}
	if lenAcc < minLen {
		minLen = lenAcc
	}

	if lenTimes != lenJudg || lenTimes != lenAcc {
		log.Printf("Error: Mismatched lengths! Time:%d, Judg:%d, Acc:%d", lenTimes, lenJudg, lenAcc)
		log.Printf("Warning: Truncating input arrays to minimum length: %d", minLen)
		if minLen == 0 {
			log.Println("Error: No consistent input events after truncation.")
			fmt.Printf("--- Replay (Duration: %.2fs) ---\n", replayData.Duration)
			fmt.Println("--- No input events ---")
			if replayData.Result != nil {
				fmt.Printf("Final Result (from data): %v\n", replayData.Result)
			}
			return
		}
		decodedTimes = decodedTimes[:minLen]
		judgments = judgments[:minLen]
		accuracies = accuracies[:minLen]
	}

	processedInputs := make([]ProcessedEvent, minLen)
	for i := 0; i < minLen; i++ {
		processedInputs[i] = ProcessedEvent{
			Index:    i,
			Time:     decodedTimes[i],
			Judgment: judgments[i],
			Accuracy: accuracies[i],
		}
	}

	if len(processedInputs) == 0 {
		log.Println("No input events to process.")
		fmt.Printf("--- Replay (Duration: %.2fs) ---\n", replayData.Duration)
		fmt.Println("--- No input events ---")
		if replayData.Result != nil {
			fmt.Printf("Final Result (from data): %v\n", replayData.Result)
		}
		return
	}

	sort.Slice(processedInputs, func(i, j int) bool {
		return processedInputs[i].Time < processedInputs[j].Time
	})

	duration := replayData.Duration
	startRealTime := time.Now()
	currentReplayTime := 0.0
	nextEventIndex := 0
	combo := 0
	maxCombo := 0

	judgmentMap := map[int]string{
		0: "Miss",
		1: "Perfect",
		2: "Great",
		3: "Good",
	}

	fmt.Printf("--- Starting Replay (Duration: %.2fs) ---\n", duration)
	fmt.Println("!!! TESTING: player-v2 !!!")
	fmt.Println("Idx | Time    | Judg Value | Judgment | Accuracy | Combo Before | Combo After | Max Combo")
	fmt.Println("----|---------|------------|----------|----------|--------------|-------------|-----------")

	for {
		currentRealTime := time.Now()
		currentReplayTime = currentRealTime.Sub(startRealTime).Seconds()

		for nextEventIndex < len(processedInputs) && processedInputs[nextEventIndex].Time <= currentReplayTime {
			event := processedInputs[nextEventIndex]
			originalIdx := event.Index
			judgVal := event.Judgment
			judgText, ok := judgmentMap[judgVal]
			if !ok {
				judgText = "Unknown"
			}
			accuracy := event.Accuracy
			comboBefore := combo

			switch judgVal {
			case 0:
				combo = 0
			case 1:
				combo++
			case 2:
				combo++
			case 3:
				combo = 0

			}

			if combo > maxCombo {
				maxCombo = combo
			}

			fmt.Printf("%-3d | %-7.3f | %-10d | %-8s | %+8.4f | %-12d | %-11d | %-9d\n", // Use correct format verbs and alignment
				originalIdx, event.Time, judgVal, judgText, accuracy, comboBefore, combo, maxCombo)

			nextEventIndex++
		}

		if nextEventIndex >= len(processedInputs) && currentReplayTime > (duration+0.5) {
			fmt.Println("\n--- Reached end of input events and duration ---")
			break
		}
		if nextEventIndex >= len(processedInputs) && duration <= 0 {
			fmt.Println("\n--- Reached end of input events (duration <= 0) ---")
			break
		}
		if currentReplayTime > duration*2 && currentReplayTime > duration+10 {
			fmt.Println("\n--- Real time significantly exceeds replay duration, stopping ---")
			break
		}

		time.Sleep(1 * time.Millisecond)
	}

	endRealTime := time.Now()

	fmt.Printf("\n--- Replay Finished ---\n")
	if replayData.Result != nil {

		resultJSON, err := json.MarshalIndent(replayData.Result, "", "  ")
		if err == nil {
			fmt.Printf("Final Result (from data):\n%s\n", string(resultJSON))
		} else {
			fmt.Printf("Final Result (from data): %v\n", replayData.Result) // Fallback
		}
	} else {
		fmt.Println("No final result block found in replay data.")
	}
	fmt.Printf("Max Combo (Live Calc): %d\n", maxCombo)
	fmt.Printf("Total Real Time: %.2fs\n", endRealTime.Sub(startRealTime).Seconds())
}

func main() {

	// func accuracyScore(score int) float64 {
	//     defaultVal := 1000000.0
	//     return (float64(score) / defaultVal) * 100.0
	// }

	replayFile := "b7ab40e922ed57078f6423b3758ae15cf7d1b777.json"

	data, err := loadReplay(replayFile)
	if err != nil {
		log.Fatalf("Failed to load replay: %v", err)
	}

	if data != nil {
		runViewer(data)
	} else {
		log.Println("Loaded data is nil, cannot run viewer.")
	}
}
