#!/usr/bin/env python3
"""Master builder: runs all parts and saves Gemao_JohnReyCarlo.pptx"""
import sys, os
from pathlib import Path

HDL_QUIZ_DECK_DIR = Path(__file__).resolve().parent
REPO_ROOT = HDL_QUIZ_DECK_DIR.parents[1]
sys.path.insert(0, str(HDL_QUIZ_DECK_DIR))
os.chdir(REPO_ROOT)

for HDL_QUIZ_DECK_PART in (
    "build_deck_part1.py",
    "build_deck_part2.py",
    "build_deck_part3.py",
    "build_deck_part4.py",
    "build_deck_part5.py",
):
    exec((HDL_QUIZ_DECK_DIR / HDL_QUIZ_DECK_PART).read_text(encoding="utf-8"))

out = REPO_ROOT / "Gemao_JohnReyCarlo.pptx"
prs.save(str(out))
print("Saved:", str(out), "| slides:", len(prs.slides.__iter__.__self__._sldIdLst))
