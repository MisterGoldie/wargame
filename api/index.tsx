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
  // Create a new state object
  const newState = {
    ...state,
    p: [...state.p],
    c: [...state.c],
    w: [...state.w]
  };

  if (!newState.iw) {
    newState.pc = newState.p.pop() || null;
    newState.cc = newState.c.pop() || null;

    if (newState.pc && newState.cc) {
      if (newState.pc.v === newState.cc.v) {
        newState.iw = true;
        newState.g = 'w';
        newState.w.push(newState.pc, newState.cc);
        newState.m = "It's WAR! Draw again for the war!";
      } else {
        const winner = newState.pc.v > newState.cc.v ? 'player' : 'computer';
        if (winner === 'player') {
          newState.p.unshift(newState.pc, newState.cc);
          newState.m = `You win this round! (${getCardLabel(newState.pc.v)} vs ${getCardLabel(newState.cc.v)})`;
        } else {
          newState.c.unshift(newState.pc, newState.cc);
          newState.m = `Computer wins this round! (${getCardLabel(newState.pc.v)} vs ${getCardLabel(newState.cc.v)})`;
        }
      }
    }
  } else {
    // Handle war
    const warCards: Card[] = [];
    for (let i = 0; i < 3; i++) {
      const playerWarCard = newState.p.pop();
      const computerWarCard = newState.c.pop();
      if (playerWarCard && computerWarCard) {
        warCards.push(playerWarCard, computerWarCard);
      }
    }
    newState.w.push(...warCards);
    newState.iw = false;
    newState.g = 'p';
  }

  // Check for game overs
  if (newState.p.length === 0 || newState.c.length === 0) {
    newState.g = 'e';
    newState.m = newState.p.length === 0 ? 'Game Over! Computer Wins!' : 'Game Over! You Win!';
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

app.frame('/game', async (c) => {
  const { buttonValue } = c;
  let state: GameState;

  if (buttonValue?.startsWith('draw:')) {
    try {
      const encodedState = buttonValue.split(':')[1];
      state = encodedState 
        ? handleTurn(JSON.parse(Buffer.from(encodedState, 'base64').toString()))
        : initializeGame();
    } catch (error) {
      console.error('Error handling game state:', error);
      state = initializeGame();
    }
  } else {
    state = initializeGame();
  }

  // Get card display text
  const getCardText = (card: Card) => {
    const suitSymbols: { [key: string]: string } = { 'h': '♥', 'd': '♦', 'c': '♣', 's': '♠' };
    return `${getCardLabel(card.v)}${suitSymbols[card.s]}`;
  };

  const cardStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '180px',
    height: '250px',
    backgroundColor: 'white',
    borderRadius: '15px',
    fontSize: '48px',
  };

  return c.res({
    image: (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1080px',
        height: '1080px',
        color: 'white',
        backgroundImage: 'url("https://bafybeihn3ynsyzeacgbubyut5buhlb7duqro7wws64p5soffgr63dq2ecq.ipfs.w3s.link/Frame%202.png")',
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '40px',
          padding: '40px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          borderRadius: '15px'
        }}>
          <div style={{ display: 'flex', gap: '40px', fontSize: '24px' }}>
            <div>Your Cards: {state.p.length}</div>
            <div>CPU Cards: {state.c.length}</div>
          </div>

          {state.pc && state.cc ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '40px' }}>
              <div style={{
                ...cardStyle,
                color: state.pc.s === 'h' || state.pc.s === 'd' ? '#ff0000' : '#000000'
              }}>
                {getCardText(state.pc)}
              </div>
              
              <div style={{ fontSize: '36px', fontWeight: 'bold' }}>VS</div>
              
              <div style={{
                ...cardStyle,
                color: state.cc.s === 'h' || state.cc.s === 'd' ? '#ff0000' : '#000000'
              }}>
                {getCardText(state.cc)}
              </div>
            </div>
          ) : (
            <div style={{ 
              fontSize: '24px',
              height: '250px',
              display: 'flex',
              alignItems: 'center'
            }}>
              Draw a card to begin!
            </div>
          )}

          <div style={{
            fontSize: '36px',
            textAlign: 'center',
            color: state.iw ? '#ff4444' : 'white'
          }}>
            {state.m}
          </div>

          {state.iw && (
            <div style={{
              fontSize: '64px',
              color: '#ff4444',
              fontWeight: 'bold'
            }}>
              WAR!
            </div>
          )}
        </div>
      </div>
    ),
    intents: [
      <Button 
        action={state.g === 'e' ? '/' : undefined}
        value={state.g !== 'e' ? `draw:${Buffer.from(JSON.stringify(state)).toString('base64')}` : undefined}
      >
        {state.g === 'e' ? 'Play Again' : 'Draw Card'}
      </Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;
