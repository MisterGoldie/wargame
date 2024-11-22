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
  hidden?: boolean;
}

type GameState = {
  p: Card[];
  c: Card[];
  pc: Card | null;
  cc: Card | null;
  m: string;
  w: boolean;
  warPile?: Card[];
  victoryMessage?: string;
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
  if (state.w) {
    const pc = state.p.pop()!;
    const cc = state.c.pop()!;
    const winner = pc.v > cc.v ? 'p' : 'c';
    const warCards = state.warPile || [];
    const newState = {
      ...state,
      pc, cc,
      w: false,
      victoryMessage: winner === 'p' 
        ? `You won the WAR with ${getCardLabel(pc.v)}!` 
        : `CPU won the WAR with ${getCardLabel(cc.v)}!`,
      warPile: []
    };

    if (winner === 'p') {
      newState.p.unshift(pc, cc, ...warCards);
    } else {
      newState.c.unshift(pc, cc, ...warCards);
    }

    return newState;
  }

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
    // War scenario
    if (state.p.length < 4 || state.c.length < 4) {
      const winner = state.p.length > state.c.length ? 'p' : 'c';
      return {
        ...state,
        m: `Not enough cards for war! ${winner === 'p' ? 'You win!' : 'Computer wins!'}`,
        w: false
      };
    }

    // Draw face-down cards
    const pWarCards = state.p.splice(-3).map(card => ({ ...card, hidden: true }));
    const cWarCards = state.c.splice(-3).map(card => ({ ...card, hidden: true }));
    
    return {
      ...state,
      pc, cc,
      w: true,
      warPile: [...cards, ...pWarCards, ...cWarCards],
      m: "WAR! 3 cards face down, next card decides the winner!"
    };
  }

  // Normal or war resolution
  const winner = pc.v > cc.v ? 'p' : 'c';
  const newState = {
    ...state,
    pc, cc,
    w: false
  };

  const allCards = [...cards, ...(state.warPile || [])];
  if (winner === 'p') {
    newState.p.unshift(...allCards);
    newState.m = `You win with ${getCardLabel(pc.v)} vs ${getCardLabel(cc.v)}!`;
  } else {
    newState.c.unshift(...allCards);
    newState.m = `Computer wins with ${getCardLabel(cc.v)} vs ${getCardLabel(pc.v)}!`;
  }
  newState.warPile = [];

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
const CardStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'space-between',
  backgroundColor: 'white',
  width: '120px',
  height: '180px',
  borderRadius: '10px',
  padding: '20px',
} as const;

function GameCard({ card }: { card: Card }) {
  if (card.hidden) {
    return (
      <div style={{
        ...CardStyle,
        backgroundColor: '#6B7280',
        color: 'white'
      }}>
        <span style={{ fontSize: '24px' }}>🂠</span>
      </div>
    );
  }
  
  return (
    <div style={{
      ...CardStyle,
      backgroundColor: 'white',
      color: card.s === '♥' || card.s === '♦' ? '#ff0000' : '#000000'
    }}>
      <span style={{ fontSize: '24px' }}>{getCardLabel(card.v)}</span>
      <span style={{ fontSize: '48px' }}>{card.s}</span>
      <span style={{ fontSize: '24px', transform: 'rotate(180deg)' }}>
        {getCardLabel(card.v)}
      </span>
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

  const isGameOver = !state.p.length || !state.c.length;

  // Style definitions with comments
  const styles = {
    // Root container - Dark background (#1a1a1a)
    root: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: '1080px',
      height: '1080px',
      backgroundColor: '#1a1a1a', // Dark theme background
      color: 'white', // Default text color
      padding: '40px'
    },

    // Game panel - Semi-transparent black overlay
    gamePanel: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.7)', // Transparent black overlay
      padding: '40px',
      borderRadius: '10px',
      gap: '40px'
    },

    // Card counter section - White text
    counter: {
      display: 'flex',
      gap: '40px',
      fontSize: '24px',
      color: 'white' // Counter text color
    },

    // Card display area
    cardArea: {
      display: 'flex',
      alignItems: 'center',
      gap: '40px'
    },

    // VS text - White
    vsText: {
      fontSize: '36px',
      fontWeight: 'bold',
      color: 'white'
    },

    // Message area - White text (Red for war)
    messageArea: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '20px'
    },

    // Game message text
    gameMessage: (isWar: boolean) => ({
      fontSize: '32px',
      color: isWar ? '#ff4444' : 'white' // Red for war, otherwise white
    }),

    // War indicator - Red text (#ff4444)
    warIndicator: {
      fontSize: '48px',
      color: '#ff4444', // War text color
      fontWeight: 'bold'
    },

    victoryMessage: {
      fontSize: '48px',
      color: '#4ADE80', // Victory green
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: '20px'
    }
  };

  return c.res({
    image: (
      <div style={styles.root}>
        <div style={styles.gamePanel}>
          <div style={styles.counter}>
            <span>Your Cards: {state.p.length}</span>
            <span>CPU Cards: {state.c.length}</span>
          </div>

          <div style={styles.cardArea}>
            {state.pc && state.cc ? (
              <>
                <GameCard card={state.pc} />
                <span style={styles.vsText}>VS</span>
                <GameCard card={state.cc} />
              </>
            ) : (
              <span style={{ fontSize: '24px', color: 'white' }}>Draw a card to begin!</span>
            )}
          </div>

          <div style={styles.messageArea}>
            <span style={styles.gameMessage(state.w)}>
              {state.m}
            </span>

            {state.w && (
              <span style={styles.warIndicator}>
                WAR!
              </span>
            )}

            {state.victoryMessage && (
              <span style={styles.victoryMessage}>
                {state.victoryMessage}
              </span>
            )}
          </div>
        </div>
      </div>
    ),
    intents: [
      <Button 
        value={!isGameOver ? `draw:${Buffer.from(JSON.stringify(state)).toString('base64')}` : undefined}
        action={isGameOver ? '/' : undefined}
      >
        {isGameOver ? 'Play Again' : state.w ? 'Draw War Cards' : 'Draw Card'}
      </Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;
