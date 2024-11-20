/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'

// Constants
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY as string;

// Define types
type Card = {
  rank: number;
  suit: string;
  display: string;
};

type GameState = {
  playerDeck: Card[];
  cpuDeck: Card[];
  playerCard: Card | null;
  cpuCard: Card | null;
  warPile: Card[];
  isWar: boolean;
  gameOver: boolean;
};

// Game Logic Functions
function createDeck(): Card[] {
  const suits = ['♠️', '♣️', '♥️', '♦️'];
  const ranks = Array.from({ length: 13 }, (_, i) => i + 2);
  const displayRanks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  
  const deck: Card[] = [];
  for (const suit of suits) {
    ranks.forEach((rank, i) => {
      deck.push({ rank, suit, display: displayRanks[i] + suit });
    });
  }
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

function encodeState(state: GameState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function decodeState(encodedState: string): GameState {
  return JSON.parse(Buffer.from(encodedState, 'base64').toString());
}

function initializeGame(): GameState {
  const deck = createDeck();
  const midpoint = Math.floor(deck.length / 2);
  
  return {
    playerDeck: deck.slice(0, midpoint),
    cpuDeck: deck.slice(midpoint),
    playerCard: null,
    cpuCard: null,
    warPile: [],
    isWar: false,
    gameOver: false
  };
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
        <div style={{ fontSize: '36px', textAlign: 'center' }}>
          Click Start to begin!
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
    } else {
      state = initializeGame();
    }
  } else {
    state = initializeGame();
  }
  
  if (buttonValue?.startsWith('draw:')) {
    // Draw cards
    if (!state.isWar) {
      state.playerCard = state.playerDeck.pop() || null;
      state.cpuCard = state.cpuDeck.pop() || null;
      
      if (state.playerCard && state.cpuCard) {
        if (state.playerCard.rank === state.cpuCard.rank) {
          state.isWar = true;
          state.warPile.push(state.playerCard, state.cpuCard);
        } else {
          const winner = state.playerCard.rank > state.cpuCard.rank ? 'player' : 'cpu';
          if (winner === 'player') {
            state.playerDeck.unshift(state.playerCard, state.cpuCard);
          } else {
            state.cpuDeck.unshift(state.playerCard, state.cpuCard);
          }
        }
      }
    } else {
      // Handle war
      for (let i = 0; i < 3; i++) {
        const playerWarCard = state.playerDeck.pop();
        const cpuWarCard = state.cpuDeck.pop();
        if (playerWarCard && cpuWarCard) {
          state.warPile.push(playerWarCard, cpuWarCard);
        }
      }
      state.isWar = false;
    }
    
    // Check for game over
    if (state.playerDeck.length === 0 || state.cpuDeck.length === 0) {
      state.gameOver = true;
    }
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
          Player Cards: {state.playerDeck.length} | CPU Cards: {state.cpuDeck.length}
        </div>
        {state.playerCard && state.cpuCard && (
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>
            {state.playerCard.display} vs {state.cpuCard.display}
          </div>
        )}
      </div>
    ),
    intents: [
      state.gameOver 
        ? <Button action="/">Play Again</Button>
        : <Button value={`draw:${encodedState}`}>Draw Card</Button>
    ]
  });
});

// Export the handlers directly from the app instance
export const GET = app.fetch;
export const POST = app.fetch;