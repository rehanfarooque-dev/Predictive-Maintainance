"""Download the Microsoft Azure Predictive Maintenance dataset from Kaggle."""
import subprocess
import sys
from pathlib import Path


RAW_DIR = Path("data/raw")
DATASET = "arnabbiswas1/microsoft-azure-predictive-maintenance"
# Resolve kaggle CLI relative to the running Python interpreter so the script
# works regardless of whether the venv is activated.
_VENV_BIN = Path(sys.executable).parent
KAGGLE_CLI = str(_VENV_BIN / "kaggle")
EXPECTED_FILES = [
    "PdM_telemetry.csv",
    "PdM_failures.csv",
    "PdM_errors.csv",
    "PdM_maint.csv",
    "PdM_machines.csv",
]


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    already_present = all((RAW_DIR / f).exists() for f in EXPECTED_FILES)
    if already_present:
        print("All CSV files already present in data/raw/. Skipping download.")
        return

    print(f"Downloading {DATASET}...")
    subprocess.run(
        [KAGGLE_CLI, "datasets", "download", "-d", DATASET, "-p", str(RAW_DIR), "--unzip"],
        check=True,
    )

    # Some Kaggle downloads nest files in a subdirectory — flatten if needed
    for f in EXPECTED_FILES:
        nested = list(RAW_DIR.rglob(f))
        if nested and nested[0] != RAW_DIR / f:
            nested[0].rename(RAW_DIR / f)

    missing = [f for f in EXPECTED_FILES if not (RAW_DIR / f).exists()]
    if missing:
        raise FileNotFoundError(f"Download incomplete. Missing: {missing}")

    print("Download complete. Files in data/raw/:")
    for f in EXPECTED_FILES:
        size_mb = (RAW_DIR / f).stat().st_size / 1e6
        print(f"  {f}: {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
