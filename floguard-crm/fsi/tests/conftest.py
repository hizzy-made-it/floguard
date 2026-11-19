"""pytest setup for the FSI pipeline. Run from floguard-crm/fsi:  python -m pytest tests -q"""
import sys
from pathlib import Path

FSI = Path(__file__).resolve().parents[1]
if str(FSI) not in sys.path:
    sys.path.insert(0, str(FSI))
