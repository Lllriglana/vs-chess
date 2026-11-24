# VS Chess

Play chess in the Visual Studio Code sidebar against Stockfish or a second player sharing your computer. Both modes run offline.

- Play White or Black against bundled Stockfish 19 Lite WASM. Choose from six difficulty levels and five thinking times. Ratings are indicative.
- Play a two-player game with optional Fischer clocks and automatic board rotation.
- Move by clicking, dragging, or using the keyboard. The board marks legal destinations, the last move, and check. Choose any of the four promotion pieces.
- Review moves in algebraic notation, undo, flip the board, or restart. VS Code saves one game per workspace and remembers your settings in your profile.
- Pick a Classic, Minimal, or Dark board and switch between illustrated and lettered pieces.

![An in-progress game against Stockfish in the VS Code sidebar](media/screenshot.png)

## Install and play

Use desktop VS Code 1.101 or newer. In the Extensions view, open the overflow menu and choose **Install from VSIX…**. Select the downloaded package. You can also install from a terminal.

```sh
code --install-extension outputs/vs-chess-0.1.0-local.vsix
```

Choose **VS Chess** in the Activity Bar. Select a game mode, then configure your color or time control. To move the view, drag its title or use VS Code's **Move View** command. Use arrow keys to move among board squares, Enter or Space to select, and Escape to clear the selection.

For threefold repetition or the 50-move rule, open **Game options** and choose **Claim draw** when available. To claim based on your next move, choose **Claim with a move** and enter that move. Fivefold repetition and 75 moves without a capture or pawn move end the game automatically. A checkmate on the final move takes precedence. Both local players can agree a draw in **Game options**.

Timed games begin on **Start game**. The clock pauses when the chess view is hidden or the window closes. Undo restores the clocks to just before the undone move. Against Stockfish, Undo returns to the last position where you could choose a different move.

## Development

Use Node.js 22.22 or later and npm. Install dependencies, run the tests, and build the extension.

```sh
npm ci
npm test
npm run build
```

Open this folder in VS Code and press **F5** to launch the Extension Development Host. To build the local VSIX, run `npm run vsix`. Its first run fetches and verifies the corresponding Stockfish source and network.

## Privacy and license

Game state and preferences stay in VS Code's local storage. VS Chess sends no telemetry and makes no network requests at runtime.

VS Chess is distributed under GPL-3.0-only. The VSIX includes the license texts and corresponding source for the distributed code. See [Third-party notices](THIRD_PARTY_NOTICES.md) for provenance and build instructions.
