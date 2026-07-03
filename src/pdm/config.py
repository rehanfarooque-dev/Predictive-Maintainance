from dataclasses import dataclass, field
from typing import Any, Dict, List
import yaml


@dataclass
class LabelingConfig:
    horizon_hours: int = 12


@dataclass
class FeaturesConfig:
    window_hours: List[int] = field(default_factory=lambda: [3, 12, 24])
    top_n_features: int = 20


@dataclass
class TuningConfig:
    n_trials: int = 50
    optimize_metric: str = "auc_pr"
    search_space: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelConfig:
    n_cv_folds: int = 5
    tuning: TuningConfig = field(default_factory=TuningConfig)


@dataclass
class EvaluationConfig:
    test_size_pct: float = 0.20
    threshold_range: List[float] = field(default_factory=lambda: [0.1, 0.9])
    threshold_step: float = 0.05


@dataclass
class OutputsConfig:
    models_dir: str = "outputs/models/"
    reports_dir: str = "outputs/reports/"


@dataclass
class Config:
    data: Dict[str, str] = field(default_factory=lambda: {"raw_dir": "data/raw/"})
    labeling: LabelingConfig = field(default_factory=LabelingConfig)
    features: FeaturesConfig = field(default_factory=FeaturesConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    evaluation: EvaluationConfig = field(default_factory=EvaluationConfig)
    outputs: OutputsConfig = field(default_factory=OutputsConfig)


def load_config(path: str = "config.yaml") -> Config:
    with open(path) as f:
        raw = yaml.safe_load(f) or {}

    labeling = LabelingConfig(**raw.get("labeling", {}))
    features = FeaturesConfig(**raw.get("features", {}))

    # ModelConfig can't use simple **unpacking because `tuning` must be
    # constructed as a TuningConfig instance first.
    tuning_raw = raw.get("model", {}).get("tuning", {})
    tuning = TuningConfig(**tuning_raw)

    model_raw = raw.get("model", {})
    model = ModelConfig(
        n_cv_folds=model_raw.get("n_cv_folds", 5),
        tuning=tuning,
    )

    evaluation = EvaluationConfig(**raw.get("evaluation", {}))
    outputs = OutputsConfig(**raw.get("outputs", {}))

    return Config(
        data=raw.get("data", {"raw_dir": "data/raw/"}),
        labeling=labeling,
        features=features,
        model=model,
        evaluation=evaluation,
        outputs=outputs,
    )
