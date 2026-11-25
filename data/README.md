# Puzzle pack

The pack contains 9,781 standard chess tactics from the [Lichess open puzzle database](https://database.lichess.org/#puzzles), released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Lichess supplied the positions, lines, themes, and difficulty ratings. The extension uses the packaged data offline.

Each record is `[PuzzleId, starting FEN, space-separated UCI solution, rating, themes]`. The FEN is the position the solver sees. For raw Lichess records, the first move in the source line is the opponent's move and has already been applied. IDs and starting positions are deduplicated. Every solution is replayed by the test suite.

The pack was assembled from the [Lichess dataset viewer](https://huggingface.co/datasets/Lichess/chess-puzzles), plus Lichess-derived subsets distributed by [Promotion Variant Chess](https://github.com/beautifulplanet/Promotion-Variant-Chess/blob/main/public/puzzles.json), [Thrie Raed Chess](https://github.com/hnsol/thrie-raed-chess/blob/main/thrie_raed_chess/data/puzzles.json), [Chessiss](https://github.com/gerankamirovitch/Chessiss/blob/main/data/puzzles.json), [Kagi’s chess puzzle benchmark](https://github.com/kagisearch/llm-chess-puzzles/blob/main/puzzles.csv), and [Lichess Puzzles Analysis](https://github.com/aKevinM/Lichess-Puzzles-Analysis/blob/main/lichess_db_puzzle_sample.csv).
