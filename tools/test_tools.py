"""Unit tests for the book tools (standard library only).

    python3 -m unittest discover -s tools -p "test_*.py"
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_voice as bv  # noqa: E402


class Tokens(unittest.TestCase):
    def test_links_are_unwrapped(self):
        self.assertEqual(bv.tokens("夜深了， {小兔:lele/look} 还 {睡着:lele}。"), ["夜深了，", "小兔", "还", "睡着。"])

    def test_sentences_split_after_stops(self):
        toks = bv.tokens("一 二。 三！ “四？” 五")
        self.assertEqual(bv.sentences(toks), [[0, 1], [2], [3], [4]])


class ProviderConfig(unittest.TestCase):
    narrator = {"provider": "qwen", "voice": "vivian", "instruct": "温柔", "say": {"voice": "Tingting", "rate": 150}}

    def test_own_block_wins(self):
        cfg = bv.provider_config(self.narrator, "say", {})
        self.assertEqual((cfg["voice"], cfg["rate"], cfg["instruct"]), ("Tingting", 150, "温柔"))

    def test_command_line_wins_and_none_is_ignored(self):
        cfg = bv.provider_config(self.narrator, "qwen", {"voice": "serena", "speed": None})
        self.assertEqual(cfg["voice"], "serena")
        self.assertNotIn("speed", cfg)
        self.assertNotIn("say", cfg)

    def test_every_provider_is_registered(self):
        self.assertTrue({"qwen", "say", "openai"} <= set(bv.PROVIDERS))


class Marks(unittest.TestCase):
    toks = bv.tokens("小兔 看见， 星星。")

    def test_word_marks_are_shared_by_character(self):
        marks = [{"text": "小兔看", "start": 0.0, "end": 0.9}, {"text": "见", "start": 0.9, "end": 1.2},
                 {"text": "星星", "start": 1.5, "end": 2.1}]
        spans = bv.spans_from_marks(marks, self.toks, [0, 1, 2], 3.0)
        self.assertEqual(spans, {0: (0.0, 0.6), 1: (0.6, 1.2), 2: (1.5, 2.1)})

    def test_marks_are_clamped_to_the_clip(self):
        marks = [{"text": "小兔看见", "start": -0.2, "end": 1.0}, {"text": "星星", "start": 1.0, "end": 9.0}]
        spans = bv.spans_from_marks(marks, self.toks, [0, 1, 2], 2.0)
        self.assertEqual(spans[0][0], 0.0)
        self.assertEqual(spans[2][1], 2.0)

    def test_marks_that_do_not_spell_the_sentence_are_refused(self):
        marks = [{"text": "小猫看见星星", "start": 0.0, "end": 2.0}]
        self.assertIsNone(bv.spans_from_marks(marks, self.toks, [0, 1, 2], 2.0))


class Alignment(unittest.TestCase):
    def test_spread_voiced_covers_the_segments_in_order(self):
        spans = bv.spread_voiced([(0.0, 1.0), (1.3, 2.0)], [2.0, 1.0, 2.0])
        self.assertEqual(len(spans), 3)
        for (s, e), (s2, _) in zip(spans, spans[1:]):
            self.assertLessEqual(s, e)
            self.assertLessEqual(e, s2 + 1e-9)
        self.assertAlmostEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[-1][1], 2.0)


if __name__ == "__main__":
    unittest.main()
