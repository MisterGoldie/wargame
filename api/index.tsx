/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'

// Constants
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY as string;
const AIRSTACK_API_URL = 'https://api.airstack.xyz/gql';
const AIRSTACK_API_KEY = process.env.AIRSTACK_API_KEY as string;
const AIRSTACK_API_KEY_SECONDARY = process.env.AIRSTACK_API_KEY_SECONDARY as string;
const MOXIE_VESTING_API_URL = "https://api.studio.thegraph.com/query/23537/moxie_vesting_mainnet/version/latest";
const MOXIE_API_URL = "https://api.studio.thegraph.com/query/23537/moxie_protocol_stats_mainnet/version/latest";

// Define types
interface Card {
  value: number;
  suit: string;
  label: string;
  imagePath: string;
}

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

function createDeck(): Card[] {
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const values = Array.from({ length: 13 }, (_, i) => i + 1);
  const deck = suits.flatMap((suit) => 
    values.map((value) => {
      const label = getCardLabel(value);
      return {
        value,
        suit,
        label: `${label} of ${suit}`,
        imagePath: `/api/public/assets/cards/${value}_of_${suit}.png`
      };
    })
  );
  return shuffle(deck);
}

function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j]!, newArray[i]!];
  }
  return newArray;
}

function initializeGame(): GameState {
  const deck = createDeck();
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
          width: '100%',
          height: '100%',
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
  const state: GameState = c.buttonValue?.startsWith('draw:') 
    ? handleTurn(JSON.parse(Buffer.from(c.buttonValue.split(':')[1], 'base64').toString()))
    : initializeGame();

  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64');

  return c.res({
    image: (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
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
          <div style={{ 
            display: 'flex', 
            gap: '20px', 
            marginBottom: '20px',
            alignItems: 'center'
          }}>
            <img 
              src={state.playerCard.imagePath} 
              alt={state.playerCard.label}
              style={{ width: '200px', height: 'auto' }}
            />
            <div style={{ fontSize: '36px', margin: '0 20px' }}>VS</div>
            <img 
              src={state.computerCard.imagePath} 
              alt={state.computerCard.label}
              style={{ width: '200px', height: 'auto' }}
            />
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