from dataclasses import dataclass
from typing import List

@dataclass
class RawReplayData:
    name: str
    version: int
    title: str
    mod: list # Extend for tag (e.g., "Hidden *num%", "DT if > 100% speed", "HT if < 100% speed")
    level: dict # level data
    difficulty: str # EXPERT, MASTER, APPEND, etcs...
    engine: dict # engine data
    thumbnail: str # thumbnail data, stored under png one
    gameplay_data: str

    def dump(self):
        return {
            "name": self.name,
            "version": self.version,
            "title": self.title,
            "mod": self.mod,
            "level": self.level,
            "difficulty": self.difficulty,
            "engine": self.engine,
            "thumbnail": self.thumbnail,
            "gameplay_data": self.gameplay_data
        }

@dataclass
class ReplayResult:
    grade: str
    accuracy: float
    combo: int
    perfect: int
    great: int
    good: int
    miss: int
    totalCount: int

@dataclass
class PlayArea:
    width: int
    height: int

@dataclass
class Inputs:
    entityIndex: List[int]
    time: List[int]
    judgment: List[int]
    accuracy: List[int]

@dataclass
class EntityData:
    name: str
    value: int

@dataclass
class Entity:
    data: List[EntityData]

@dataclass
class Touches:
    l: List[int]
    t: List[int]
    x: List[int]
    y: List[int]

@dataclass
class ReplayDataRel:
    startTime: int
    saveTime: int
    duration: int
    inputOffset: int
    playArea: PlayArea
    result: ReplayResult
    inputs: Inputs
    entities: List[Entity]
    touches: Touches

    def dump(self):
        return self.__dict__

@dataclass
class ReplayData:
    replay: ReplayDataRel
    result: ReplayResult

    def dump(self):
        return {
            "replay": self.replay.dump(),
            "result": {
                "grade": self.result.grade,
                "accuracy": self.result.accuracy,
                "combo": self.result.combo,
                "perfect": self.result.perfect,
                "great": self.result.great,
                "good": self.result.good,
                "miss": self.result.miss,
                "totalCount": self.result.totalCount
            }
        }