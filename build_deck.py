#!/usr/bin/env python3
"""Master builder: runs all parts and saves Gemao_JohnReyCarlo.pptx"""
import sys, os
sys.path.insert(0, "/home/user/hacienda-de-luisana")
os.chdir("/home/user/hacienda-de-luisana")

exec(open("build_deck_part1.py").read())
exec(open("build_deck_part2.py").read())
exec(open("build_deck_part3.py").read())
exec(open("build_deck_part4.py").read())
exec(open("build_deck_part5.py").read())

out = "/home/user/hacienda-de-luisana/Gemao_JohnReyCarlo.pptx"
prs.save(out)
print("Saved:", out, "| slides:", len(prs.slides.__iter__.__self__._sldIdLst))
