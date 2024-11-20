/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import { JSX } from 'frog/jsx';
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'
import { gql, GraphQLClient } from "graphql-request";

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
  p: Card[];
  c: Card[];
  pc: Card | null;
  cc: Card | null;
  w: Card[];
  m: string;
  g: 'i' | 'p' | 'w' | 'e';
  iw: boolean;
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
  const suits = ['c', 'd', 'h', 's'];
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
    w: [],                         // warPile
    m: 'Welcome to War! Draw a card to begin.',  // message
    g: 'i',                        // gameStatus: initial
    iw: false                      // isWar
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
  if (!state.iw) {
    state.pc = state.p.pop() || null;
    state.cc = state.c.pop() || null;

    if (state.pc && state.cc) {
      if (state.pc.v === state.cc.v) {
        state.iw = true;
        state.g = 'w';
        state.w.push(state.pc, state.cc);
        state.m = "It's WAR! Draw again for the war!";
      } else {
        const winner = state.pc.v > state.cc.v ? 'player' : 'computer';
        if (winner === 'player') {
          state.p.unshift(state.pc, state.cc);
          state.m = `You win this round! (${state.pc.v} of ${state.pc.s} vs ${state.cc.v} of ${state.cc.s})`;
        } else {
          state.c.unshift(state.pc, state.cc);
          state.m = `Computer wins this round! (${state.pc.v} of ${state.pc.s} vs ${state.cc.v} of ${state.cc.s})`;
        }
      }
    }
  } else {
    // Handle war
    const warCards: Card[] = [];
    for (let i = 0; i < 3; i++) {
      const playerWarCard = state.p.pop();
      const computerWarCard = state.c.pop();
      if (playerWarCard && computerWarCard) {
        warCards.push(playerWarCard, computerWarCard);
      }
    }
    state.w.push(...warCards);
    state.iw = false;
    state.g = 'p';
  }

  // Check for game over
  if (state.p.length === 0 || state.c.length === 0) {
    state.g = 'e';
    state.m = state.p.length === 0 ? 'Game Over! Computer Wins!' : 'Game Over! You Win!';
  }

  return state;
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

app.frame('/game', async (c) => {
  const { buttonValue, frameData } = c;
  const fid = frameData?.fid;

  // Get user info
  let username = 'Player';
  let profileImage = null;
  
  if (fid) {
    try {
      [username, profileImage] = await Promise.all([
        getUsername(fid.toString()),
        getUserProfilePicture(fid.toString())
      ]);
    } catch (error) {
      console.error('Error getting user info:', error);
    }
  }

  let state: GameState;
  if (buttonValue?.startsWith('draw:')) {
    const encodedState = buttonValue.split(':')[1];
    if (encodedState) {
      state = JSON.parse(Buffer.from(encodedState, 'base64').toString());
      state = handleTurn(state);
    } else {
      state = initializeGame();
    }
  } else {
    state = initializeGame();
  }

  const encodedState = Buffer.from(JSON.stringify(state)).toString('base64');

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
          {/* Card Counts */}
          <div style={{
            display: 'flex',
            gap: '40px',
            fontSize: '24px'
          }}>
            <span>Your Cards: {state.p.length}</span>
            <span>CPU Cards: {state.c.length}</span>
          </div>

          {/* Cards */}
          {state.pc && state.cc && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '40px'
            }}>
              {getCardSVG(state.pc)}
              <div style={{ fontSize: '36px' }}>VS</div>
              {getCardSVG(state.cc)}
            </div>
          )}

          {/* Message */}
          <div style={{
            fontSize: '36px',
            color: state.iw ? '#ff4444' : 'white',
            textAlign: 'center'
          }}>
            {state.m}
          </div>
          
          {state.iw && (
            <div style={{ 
              fontSize: '64px',
              color: '#ff4444'
            }}>
              WAR!
            </div>
          )}
        </div>
      </div>
    ),
    intents: [
      state.g === 'e'
        ? <Button action="/">Play Again</Button>
        : <Button value={`draw:${encodedState}`}>Draw Card</Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;

// Add this helper function to get full card details for displayS
/** @jsxImportSource frog/jsx */
import { Child } from 'hono/jsx';

// Update function signature to use Child return type
function getCardSVG(card: Card) {
  const suitSymbols: Record<string, string> = {
    'h': '♥',
    'd': '♦',
    'c': '♣',
    's': '♠'
  };

  const suitColors: Record<string, string> = {
    'h': '#ff0000',
    'd': '#ff0000',
    'c': '#000000',
    's': '#000000'
  };

  return (
    <div style={{
      width: '180px',
      height: '250px',
      backgroundColor: 'white',
      borderRadius: '10px',
      border: '1px solid #000',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        color: suitColors[card.s],
        fontSize: '24px'
      }}>
        {getCardLabel(card.v)}
      </div>
      <div style={{
        color: suitColors[card.s],
        fontSize: '72px'
      }}>
        {suitSymbols[card.s]}
      </div>
      <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        color: suitColors[card.s],
        fontSize: '24px',
        transform: 'rotate(180deg)'
      }}>
        {getCardLabel(card.v)}
      </div>
    </div>
  );
}
