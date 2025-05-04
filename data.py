from dataclasses import dataclass
from typing import List

@dataclass
class RawReplayData:
    name: str
    version: int
    title: str
    mod: list # Extend for tag (e.g., "Hidden *num%", "DT if > 100% speed", "HT if < 100% speed")
    level: dict # level data
    rating: int
    difficulty: str # EXPERT, MASTER, APPEND, etcs...
    engine: dict # engine data
    thumbnail: str # thumbnail data, stored under png one
    gameplay_data: str

    def to_dict(self):
        return {
            "name": self.name,
            "version": self.version,
            "title": self.title,
            "mod": self.mod,
            "level": self.level,
            "rating": self.rating,
            "difficulty": self.difficulty,
            "engine": self.engine,
            "thumbnail": self.thumbnail,
            "gameplay_data": self.gameplay_data
        }

    def __getitem__(self, item):
        return getattr(self, item)

@dataclass
class ReplayResult:
    grade: str
    arcadeScore: int
    accuracyScore: float
    combo: int
    perfect: int
    great: int
    good: int
    miss: int
    totalCount: int

@dataclass
class Inputs:
    entityIndex: List[int]
    time: List[int]
    judgment: List[int]
    accuracy: List[int]

@dataclass
class ReplayDataRel:
    startTime: int
    saveTime: int
    duration: int
    inputOffset: int
    result: ReplayResult
    inputs: Inputs

    def to_dict(self):
        return {
            "startTime": self.startTime,
            "saveTime": self.saveTime,
            "duration": self.duration,
            "inputOffset": self.inputOffset,
            "result": self.result.__dict__,
            "inputs": self.inputs.__dict__
        }

    @classmethod
    def parser(cls, data) -> "ReplayDataRel":
        return cls(
            startTime=data["startTime"],
            saveTime=data["saveTime"],
            duration=data["duration"],
            inputOffset=data["inputOffset"],
            result=ReplayResult(**data["result"]),
            inputs=Inputs(**data["inputs"])
        )

@dataclass
class MetaData:
    name: str
    version: int
    title: str
    mod: list[str] # Extend for tag (e.g., "Hidden *num%", "DT if > 100% speed", "HT if < 100% speed")
    level: dict # level data
    rating: int
    difficulty: str # EXPERT, MASTER, APPEND, etcs...
    thumbnail: str

    def to_dict(self):
        return {
            "name": self.name,
            "version": self.version,
            "title": self.title,
            "mod": self.mod,
            # "level": self.level,
            "rating": self.rating,
            "difficulty": self.difficulty,
            "thumbnail": self.thumbnail
        }

    @classmethod
    def parser(cls, data) -> "MetaData":
        return cls(
            name=data["name"],
            version=data["version"],
            title=data["title"],
            mod=data["mod"],
            level=data["level"],
            rating=data["rating"],
            difficulty=data["difficulty"],
            thumbnail=data["thumbnail"]
        )

@dataclass
class ReplayData:
    meta: MetaData
    replay: ReplayDataRel
    result: ReplayResult

    def to_dict(self):
        return {
            "metadata": self.meta.to_dict(),
            "replay": self.replay.to_dict(),
            "result": {
                "grade": self.result.grade,
                "arcadeScore": self.result.arcadeScore,
                "accuracyScore": self.result.accuracyScore,
                "combo": self.result.combo,
                "perfect": self.result.perfect,
                "great": self.result.great,
                "good": self.result.good,
                "miss": self.result.miss,
                "totalCount": self.result.totalCount
            }
        }

    @classmethod
    def from_dict(cls, metadata: RawReplayData, data) -> "ReplayData":
        return cls(
            meta=MetaData.parser(metadata),
            replay=ReplayDataRel.parser(data),
            result=ReplayResult(**data["result"])
        )
