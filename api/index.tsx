/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'

// Constants
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY as string;

// Define types
type Card = {
  value: number;
  suit: string;
  label: string;
  filename: string;
};

type GameState = {
  playerDeck: Card[];
  computerDeck: Card[];
  playerCard: Card | null;
  computerCard: Card | null;
  warPile: Card[];
  message: string;
  gameStatus: 'initial' | 'playing' | 'war' | 'ended';
  isWar: boolean;
};

function getCardLabel(value: number): string {
  const specialCards: Record<number, string> = {
    1: 'Ace',
    11: 'Jack',
    12: 'Queen',
    13: 'King'
  };
  return specialCards[value] || value.toString();
}

function createShuffledDeck(): Card[] {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values = Array.from({ length: 13 }, (_, i) => i + 1);
  const deck = suits.flatMap((suit) => 
    values.map((value) => {
      const label = getCardLabel(value);
      return {
        value,
        suit,
        label: `${label} of ${suit}`,
        filename: `${value}_of_${suit}.png`
      };
    })
  );
  return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = newArray[i]!;
    newArray[i] = newArray[j]!;
    newArray[j] = temp;
  }
  return newArray;
}

function initializeGame(): GameState {
  const deck = createShuffledDeck();
  const midpoint = Math.floor(deck.length / 2);
  return {
    playerDeck: deck.slice(0, midpoint),
    computerDeck: deck.slice(midpoint),
    playerCard: null,
    computerCard: null,
    warPile: [],
    message: 'Welcome to War! Draw a card to begin.',
    gameStatus: 'initial',
    isWar: false
  };
}

function encodeState(state: GameState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function decodeState(encodedState: string): GameState {
  return JSON.parse(Buffer.from(encodedState, 'base64').toString());
}

// Create Frog app instance
export const app = new Frog<{ Variables: NeynarVariables }>({
  basePath: '/api',
  imageOptions: {
    width: 1080,
    height: 1080
  },
  imageAspectRatio: '1:1',
  title: 'WAR Card Game'
});

app.use(neynar({
  apiKey: NEYNAR_API_KEY,
  features: ['interactor']
}));

// Game Logic
function handleTurn(state: GameState): GameState {
  if (!state.isWar) {
    state.playerCard = state.playerDeck.pop() || null;
    state.computerCard = state.computerDeck.pop() || null;

    if (state.playerCard && state.computerCard) {
      if (state.playerCard.value === state.computerCard.value) {
        state.isWar = true;
        state.gameStatus = 'war';
        state.warPile.push(state.playerCard, state.computerCard);
        state.message = "It's WAR! Draw again for the war!";
      } else {
        const winner = state.playerCard.value > state.computerCard.value ? 'player' : 'computer';
        if (winner === 'player') {
          state.playerDeck.unshift(state.playerCard, state.computerCard);
          state.message = `You win this round! (${state.playerCard.label} vs ${state.computerCard.label})`;
        } else {
          state.computerDeck.unshift(state.playerCard, state.computerCard);
          state.message = `Computer wins this round! (${state.playerCard.label} vs ${state.computerCard.label})`;
        }
      }
    }
  } else {
    // Handle war
    const warCards: Card[] = [];
    for (let i = 0; i < 3; i++) {
      const playerWarCard = state.playerDeck.pop();
      const computerWarCard = state.computerDeck.pop();
      if (playerWarCard && computerWarCard) {
        warCards.push(playerWarCard, computerWarCard);
      }
    }
    state.warPile.push(...warCards);
    state.isWar = false;
    state.gameStatus = 'playing';
  }

  // Check for game over
  if (state.playerDeck.length === 0 || state.computerDeck.length === 0) {
    state.gameStatus = 'ended';
    state.message = state.playerDeck.length === 0 ? 'Game Over! Computer Wins!' : 'Game Over! You Win!';
  }

  return state;
}

// Routes
app.frame('/', (c) => {
  return c.res({
    image: (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1080px',
          height: '1080px',
          backgroundColor: '#1a1a1a',
          color: 'white',
          padding: '40px'
        }}
      >
        <h1 style={{ fontSize: '72px', marginBottom: '40px' }}>
          War Card Game
        </h1>
        <div style={{ fontSize: '36px', textAlign: 'center', marginBottom: '40px' }}>
          Classic card game of War!
        </div>
        <div style={{ fontSize: '24px', textAlign: 'center' }}>
          Draw cards and compete against the computer.
        </div>
      </div>
    ),
    intents: [
      <Button action="/game">Start Game</Button>
    ]
  });
});

app.frame('/game', (c) => {
  const { buttonValue } = c;
  let state: GameState;

  if (buttonValue?.startsWith('draw:')) {
    const encodedState = buttonValue.split(':')[1];
    if (encodedState) {
      state = decodeState(encodedState);
      state = handleTurn(state);
    } else {
      state = initializeGame();
    }
  } else {
    state = initializeGame();
  }

  const encodedState = encodeState(state);

  return c.res({
    image: (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1080px',
          height: '1080px',
          backgroundColor: '#1a1a1a',
          color: 'white',
          padding: '40px'
        }}
      >
        <div style={{ fontSize: '24px', marginBottom: '20px' }}>
          Your Cards: {state.playerDeck.length} | Computer Cards: {state.computerDeck.length}
        </div>
        <div style={{ fontSize: '36px', marginBottom: '40px', textAlign: 'center' }}>
          {state.message}
        </div>
        {state.playerCard && state.computerCard && (
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>
            {state.playerCard.label} vs {state.computerCard.label}
          </div>
        )}
        {state.isWar && (
          <div style={{ fontSize: '64px', color: '#ff4444', marginBottom: '20px' }}>
            WAR!
          </div>
        )}
      </div>
    ),
    intents: [
      state.gameStatus === 'ended'
        ? <Button action="/">Play Again</Button>
        : <Button value={`draw:${encodedState}`}>Draw Card</Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;