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
  v: number;
  s: string;
}

type GameState = {
  p: Card[];    // player cards
  c: Card[];    // computer cards
  pc: Card | null;  // player current card
  cc: Card | null;  // computer current card
  m: string;    // message
  w: boolean;   // is war
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
  const suits = ['♠', '♣', '♥', '♦'];  // Using actual suit symbols
  const values = Array.from({ length: 13 }, (_, i) => i + 1);
  return shuffle(suits.flatMap(s => 
    values.map(v => ({ v, s }))
  ));
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
    p: deck.slice(0, midpoint),    // playerDeck
    c: deck.slice(midpoint),       // computerDeck
    pc: null,                      // playerCard
    cc: null,                      // computerCard
    m: 'Welcome to War! Draw a card to begin.',  // message
    w: false                       // isWar
  };
}

// 1. Add these functions at the top with other utility functions
async function getUsername(fid: string): Promise<string> {
  const query = `
    query ($fid: String!) {
      Socials(input: {filter: {dappName: {_eq: farcaster}, userId: {_eq: $fid}}, blockchain: ethereum}) {
        Social {
          profileName
        }
      }
    }
  `;

  try {
    const response = await fetch(AIRSTACK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AIRSTACK_API_KEY,
      },
      body: JSON.stringify({ query, variables: { fid } }),
    });

    const data = await response.json();
    return data?.data?.Socials?.Social?.[0]?.profileName || 'Player';
  } catch (error) {
    console.error('Error fetching username:', error);
    return 'Player';
  }
}

async function getUserProfilePicture(fid: string): Promise<string | null> {
  const query = `
    query GetUserProfilePicture($fid: String!) {
      Socials(
        input: {filter: {dappName: {_eq: farcaster}, userId: {_eq: $fid}}, blockchain: ethereum}
      ) {
        Social {
          profileImage
        }
      }
    }
  `;

  try {
    const response = await fetch(AIRSTACK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': AIRSTACK_API_KEY_SECONDARY,
      },
      body: JSON.stringify({ query, variables: { fid } }),
    });

    const data = await response.json();
    if (data?.data?.Socials?.Social?.[0]?.profileImage) {
      let profileImage = data.data.Socials.Social[0].profileImage;
      const imgurMatch = profileImage.match(/https:\/\/i\.imgur\.com\/[^.]+\.[a-zA-Z]+/);
      if (imgurMatch) {
        profileImage = imgurMatch[0];
      }
      return profileImage;
    }
    return null;
  } catch (error) {
    console.error('Error fetching profile image:', error);
    return null;
  }
}
// Create Frog app instance
export const app = new Frog<{ Variables: NeynarVariables }>({
  basePath: '/api',
  imageOptions: {
    width: 1080,
    height: 1080,
    fonts: [
      {
        name: 'Silkscreen',
        source: 'google',
        weight: 400,
      }
    ],
  },
  imageAspectRatio: '1:1',
  title: 'WAR Card Game'
});

app.use(neynar({ apiKey: NEYNAR_API_KEY, features: ['interactor'] }));
function handleTurn(state: GameState): GameState {
  if (!state.p.length || !state.c.length) {
    return {
      ...state,
      m: `Game Over! ${state.p.length ? 'You win!' : 'Computer wins!'}`,
      w: false
    };
  }

  const pc = state.p.pop()!;
  const cc = state.c.pop()!;
  const cards = [pc, cc];

  if (pc.v === cc.v) {
    return {
      ...state,
      pc, cc,
      m: "WAR! Draw again!",
      w: true
    };
  }

  const winner = pc.v > cc.v ? 'p' : 'c';
  const newState = {
    ...state,
    pc, cc,
    w: false
  };

  if (winner === 'p') {
    newState.p.unshift(...cards);
    newState.m = `You win with ${getCardLabel(pc.v)} vs ${getCardLabel(cc.v)}!`;
  } else {
    newState.c.unshift(...cards);
    newState.m = `Computer wins with ${getCardLabel(cc.v)} vs ${getCardLabel(pc.v)}!`;
  }

  return newState;
}

// Routes
app.frame('/', (c) => {
  return c.res({
    image: (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1080px',
        height: '1080px',
        backgroundColor: '#1a1a1a',
        color: 'white'
      }}>
        <div style={{ 
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px'
        }}>
          <h1 style={{ fontSize: '72px', margin: 0 }}>
            War Card Game
          </h1>
          <div style={{ fontSize: '36px', textAlign: 'center' }}>
            Click Start to begin!
          </div>
        </div>
      </div>
    ),
    intents: [
      <Button action="/game">Start Game</Button>
    ]
  });
});

// Card component
function Card({ card }: { card: Card }) {
  return (
    <div style={{
      width: '120px',
      height: '180px',
      backgroundColor: 'white',
      borderRadius: '10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '10px',
      color: card.s === '♥' || card.s === '♦' ? '#ff0000' : '#000000'
    }}>
      <div style={{ fontSize: '24px' }}>{getCardLabel(card.v)}</div>
      <div style={{ fontSize: '48px' }}>{card.s}</div>
      <div style={{ fontSize: '24px', transform: 'rotate(180deg)' }}>
        {getCardLabel(card.v)}
      </div>
    </div>
  );
}

// Game frame handler
app.frame('/game', async (c) => {
  let state: GameState;
  const { buttonValue } = c;

  if (buttonValue?.startsWith('draw:')) {
    try {
      const encodedState = buttonValue.split(':')[1];
      state = handleTurn(JSON.parse(Buffer.from(encodedState, 'base64').toString()));
    } catch (error) {
      console.error('State processing error:', error);
      state = initializeGame();
    }
  } else {
    state = initializeGame();
  }

  const gameView = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '20px',
      padding: '20px',
      backgroundColor: 'rgba(0,0,0,0.8)',
      borderRadius: '10px',
      width: '100%',
      maxWidth: '800px'
    }}>
      <div style={{ fontSize: '24px' }}>
        Your Cards: {state.p.length} | CPU Cards: {state.c.length}
      </div>

      {state.pc && state.cc ? (
        <div style={{
          display: 'flex',
          gap: '40px',
          alignItems: 'center'
        }}>
          <Card card={state.pc} />
          <div style={{ fontSize: '36px', fontWeight: 'bold' }}>VS</div>
          <Card card={state.cc} />
        </div>
      ) : null}

      <div style={{
        fontSize: '32px',
        color: state.w ? '#ff4444' : 'white'
      }}>
        {state.m}
      </div>

      {state.w && (
        <div style={{
          fontSize: '48px',
          color: '#ff4444',
          fontWeight: 'bold'
        }}>
          WAR!
        </div>
      )}
    </div>
  );

  return c.res({
    image: (
      <div style={{
        width: '1080px',
        height: '1080px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a1a',
        color: 'white'
      }}>
        {gameView}
      </div>
    ),
    intents: [
      <Button 
        value={
          !state.p.length || !state.c.length 
            ? undefined 
            : `draw:${Buffer.from(JSON.stringify(state)).toString('base64')}`
        }
      >
        {
          !state.p.length || !state.c.length 
            ? 'Play Again' 
            : 'Draw Card'
        }
      </Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;
