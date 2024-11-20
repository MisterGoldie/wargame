/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
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
  l: string;
  p: string;
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
  const deck = suits.flatMap((s) => 
    values.map((v) => {
      const l = getCardLabel(v);
      return {
        v,
        s,
        l: `${l} of ${s}`,
        p: `/api/public/assets/cards/${v}_of_${s}.png`
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
  initialState: {
    playerDeck: [],
    computerDeck: [],
    playerCard: null,
    computerCard: null,
    warPile: [],
    message: '',
    gameStatus: 'initial',
    isWar: false
  },
  title: 'Frog Game'
});

app.use(neynar({ apiKey: NEYNAR_API_KEY, features: ['interactor'] }));
function handleTurn(state: GameState): GameState {
  if (!state.isWar) {
    state.playerCard = state.playerDeck.pop() || null;
    state.computerCard = state.computerDeck.pop() || null;

    if (state.playerCard && state.computerCard) {
      if (state.playerCard.v === state.computerCard.v) {
        state.isWar = true;
        state.gameStatus = 'war';
        state.warPile.push(state.playerCard, state.computerCard);
        state.message = "It's WAR! Draw again for the war!";
      } else {
        const winner = state.playerCard.v > state.computerCard.v ? 'player' : 'computer';
        if (winner === 'player') {
          state.playerDeck.unshift(state.playerCard, state.computerCard);
          state.message = `You win this round! (${state.playerCard.l} vs ${state.computerCard.l})`;
        } else {
          state.computerDeck.unshift(state.playerCard, state.computerCard);
          state.message = `Computer wins this round! (${state.playerCard.l} vs ${state.computerCard.l})`;
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
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1080px',
        height: '1080px',
        backgroundColor: '#1a1a1a',
        color: 'white',
        padding: '40px'
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

  // Handle game state
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
        width: '1080px',
        height: '1080px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a1a',
        color: 'white',
        position: 'relative'
      }}>
        {/* Profile Section */}
        <div style={{ 
          position: 'absolute',
          top: '40px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px'
        }}>
          {profileImage && (
            <img 
              src={profileImage}
              alt={username}
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                border: '2px solid white'
              }}
            />
          )}
          <div style={{ fontSize: '24px' }}>
            {username} vs CPU
          </div>
        </div>

        {/* Card Count Display */}
        <div style={{ 
          display: 'flex',
          fontSize: '24px',
          gap: '40px',
          marginBottom: '20px'
        }}>
          <div>Your Cards: {state.playerDeck.length}</div>
          <div>CPU Cards: {state.computerDeck.length}</div>
        </div>

        {/* Card Display */}
        {state.playerCard && state.computerCard ? (
          <div style={{ 
            display: 'flex',
            gap: '40px',
            alignItems: 'center'
          }}>
            <img 
              src={state.playerCard.p}
              alt={state.playerCard.l}
              style={{ width: '180px', height: 'auto' }}
            />
            <div style={{ fontSize: '36px' }}>VS</div>
            <img 
              src={state.computerCard.p}
              alt={state.computerCard.l}
              style={{ width: '180px', height: 'auto' }}
            />
          </div>
        ) : (
          <div style={{ fontSize: '24px' }}>
            Click Draw Card to play!
          </div>
        )}

        {/* Game Message */}
        <div style={{ 
          fontSize: '36px',
          textAlign: 'center',
          margin: '20px 0',
          color: state.isWar ? '#ff4444' : 'white'
        }}>
          {state.message}
        </div>

        {/* War Alert */}
        {state.isWar && (
          <div style={{ 
            fontSize: '64px',
            color: '#ff4444'
          }}>
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