# Replay Data

Replay data is used by Sonolus app to provide extra information to watch mode.

## Resource Type

JSON resource.

`.json` is the only supported format, and must also be GZip compressed.

## Syntax

```ts
type ReplayData = {
    startTime: number
    saveTime: number  
    duration: number
    inputOffset: number
    playArea: {
        width: number
        height: number
    }
    result: GameplayResult
    inputs: {
        entityIndex: number[]
        time: number[]
        judgment: number[]
        accuracy: number[]
    }
    entities: {
        data: {
            name: string
            value: number
        }[]
    }[]
    touches: {
        l: number[]
        t: number[]
        x: number[]
        y: number[]
    }
}
```

### `inputs.entityIndex`, `inputs.time`, `touches.t`, `touches.x`, and `touches.y`

Values are delta encoded.

## Examples

```json
{
    "startTime": 1640995200000,
    "saveTime": 1640995320000,
    "duration": 120,
    "inputOffset": 0.05,
    "playArea": {
        "width": 1024,
        "height": 768
    },
    "result": {
        // ...
    },
    "inputs": {
        "entityIndex": [
            // ...
        ],
        "time": [
            // ...
        ],
        "judgment": [
            // ...
        ],
        "accuracy": [
            // ...
        ]
    },
    "entities": [
        {
            "data": [
                // ...
            ]
        }
        // more entities
    ],
    "touches": {
        "l": [
            // ...
        ],
        "t": [
            // ...
        ],
        "x": [
            // ...
        ],
        "y": [
            // ...
        ]
    }
}
```
# Replay Configuration

Replay configuration is used by Sonolus app to populate replay configuration interface.

## Resource Type

JSON resource.

`.json` is the only supported format, and must also be GZip compressed.

## Syntax

```ts
type ReplayConfiguration = {
    options: number[]
}
```

### `options`

Engine option values.

## Examples

```json
{
    "options": [
        // ...
    ]
}
```
# `GameplayResult`

`GameplayResult` provides result information of gameplay.

# Syntax

```ts
type GameplayResult = {
    grade: 'allPerfect' | 'fullCombo' | 'pass' | 'fail'
    arcadeScore: number
    accuracyScore: number
    combo: number
    perfect: number
    great: number
    good: number
    miss: number
    totalCount: number
}
```

# Examples

```json
{
    "grade": "allPerfect",
    "arcadeScore": 1000000,
    "accuracyScore": 987654,
    "combo": 765,
    "perfect": 765,
    "great": 0,
    "good": 0,
    "miss": 0,
    "totalCount": 765
}
```