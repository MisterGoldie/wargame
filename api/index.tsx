/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'
import { GraphQLClient, gql } from 'graphql-request'
import admin from 'firebase-admin';

// Firebase initialization
let db: admin.firestore.Firestore | null = null;
let initializationError: Error | null = null;

try {
  console.log('Starting Firebase initialization...');
  
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  console.log('Environment variables loaded:');
  console.log('Project ID:', projectId);
  console.log('Client Email:', clientEmail);
  console.log('Private Key exists:', !!privateKey);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase configuration environment variables');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
    console.log('Firebase Admin SDK initialized successfully');
  } else {
    console.log('Firebase app already initialized');
  }

  db = admin.firestore();
  console.log('Firestore instance created successfully');
} catch (error) {
  console.error('Error in Firebase initialization:', error);
  if (error instanceof Error) {
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    initializationError = error;
  }
  db = null;
}

const getDb = () => {
  if (db) {
    return db;
  }
  if (initializationError) {
    console.error('Firestore initialization failed earlier:', initializationError);
    throw initializationError;
  }
  throw new Error('Firestore is not initialized and no initialization error was caught');
};

// Add helper functions for game stats
interface GameStats {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
}

async function updateGameStats(fid: string, result: 'win' | 'loss' | 'tie'): Promise<void> {
  try {
    const firestore = getDb();
    const statsRef = firestore.collection('farcasterGames').doc('war game').collection('players').doc(fid);
    
    await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(statsRef);
      const currentStats = doc.exists ? doc.data() as GameStats : {
        wins: 0,
        losses: 0,
        ties: 0,
        gamesPlayed: 0
      };

      const newStats = {
        ...currentStats,
        [result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'ties']: currentStats[result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'ties'] + 1,
        gamesPlayed: currentStats.gamesPlayed + 1,
        lastPlayed: admin.firestore.FieldValue.serverTimestamp(),
        fid: fid
      };

      transaction.set(statsRef, newStats);
    });

    console.log(`Updated war game stats for FID ${fid}:`, result);
  } catch (error) {
    console.error('Error updating war game stats:', error);
    throw error;
  }
}

async function getGameStats(fid: string): Promise<GameStats> {
  try {
    const firestore = getDb();
    const statsDoc = await firestore.collection('farcasterGames').doc('war game').collection('players').doc(fid).get();
    
    if (!statsDoc.exists) {
      return {
        wins: 0,
        losses: 0,
        ties: 0,
        gamesPlayed: 0
      };
    }

    return statsDoc.data() as GameStats;
  } catch (error) {
    console.error('Error fetching war game stats:', error);
    throw error;
  }
}

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
  isNuke?: boolean;
}

type GameState = {
  p: Card[];                // Player's deck
  c: Card[];                // Computer's deck
  pc: Card | null;          // Player's current card
  cc: Card | null;          // Computer's current card
  m: string;                // Game message
  w: boolean;               // War state
  warPile?: Card[];         // Cards in war pile
  victoryMessage?: string;  // Victory message overlay
  lastDrawTime?: number;    // Cooldown tracking
  username?: string;        // Player's username
  moveCount?: number;       // Track total moves
  warCount?: number;        // Track consecutive wars
  fanTokenData?: {          // Fan token data
    ownsToken: boolean;
    balance: number;
  };
  playerNukeAvailable?: boolean;
  cpuNukeAvailable?: boolean;
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

function createRegularDeck(): Card[] {
  const suits = ['♠', '♣', '♥', '♦'];
  const values = Array.from({ length: 13 }, (_, i) => i + 1);
  return suits.flatMap(s => values.map(v => ({ v, s })));
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
  const regularDeck = createRegularDeck();
  const playerNuke: Card = { v: 10, s: '☢️', isNuke: true };
  const cpuNuke: Card = { v: 10, s: '☢️', isNuke: true };
  
  // Add nukes and shuffle
  const fullDeck = shuffle([...regularDeck, playerNuke, cpuNuke]);
  const midpoint = Math.floor(fullDeck.length / 2);
  
  const initialState: GameState = {
    p: fullDeck.slice(0, midpoint),
    c: fullDeck.slice(midpoint),
    pc: null,
    cc: null,
    m: 'Welcome to War! Draw a card to begin. You have one nuke card available!',
    w: false,
    lastDrawTime: Date.now(),
    playerNukeAvailable: true,
    cpuNukeAvailable: true,
    moveCount: 0,
    warCount: 0
  };

  verifyCardCount(initialState, 'GAME_INIT');
  console.log('Game initialized:', {
    totalCards: fullDeck.length,
    playerCards: initialState.p.length,
    cpuCards: initialState.c.length,
    nukeCardsAdded: 2
  });

  return initialState;
}

// 1. Add these functions at the top with other utility functions
// Add interface for the username query response
interface UsernameResponse {
  Socials: {
    Social: Array<{
      profileName: string;
    }>;
  };
}

async function getUsername(fid: string): Promise<string> {
  const graphQLClient = new GraphQLClient(AIRSTACK_API_URL, {
    headers: {
      'Authorization': AIRSTACK_API_KEY,
    },
  });

  const query = gql`
    query ($fid: String!) {
      Socials(input: {filter: {dappName: {_eq: farcaster}, userId: {_eq: $fid}}, blockchain: ethereum}) {
        Social {
          profileName
        }
      }
    }
  `;

  try {
    const data = await graphQLClient.request<UsernameResponse>(query, { fid });
    console.log('Username API response:', JSON.stringify(data));
    
    if (data?.Socials?.Social?.[0]?.profileName) {
      return data.Socials.Social[0].profileName;
    } else {
      console.log('Unexpected API response structure:', JSON.stringify(data));
      return 'Player';
    }
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

// Update TokenHolding interface
interface TokenHolding {
  balance: string;
  buyVolume: string;
  sellVolume: string;
  subjectToken: {
    name: string;
    symbol: string;
    currentPriceInMoxie: string;
  };
}

interface PortfolioResponse {
  users: Array<{
    portfolio: TokenHolding[];
  }>;
}

// Add the API functions
async function getVestingContractAddress(beneficiaryAddresses: string[]): Promise<string | null> {
  const graphQLClient = new GraphQLClient(MOXIE_VESTING_API_URL);

  const query = gql`
    query MyQuery($beneficiaries: [Bytes!]) {
      tokenLockWallets(where: {beneficiary_in: $beneficiaries}) {
        address: id
        beneficiary
      }
    }
  `;

  const variables = {
    beneficiaries: beneficiaryAddresses.map(address => address.toLowerCase())
  };

  try {
    const data = await graphQLClient.request<any>(query, variables);
    console.log('Vesting contract data:', JSON.stringify(data, null, 2));

    if (data.tokenLockWallets && data.tokenLockWallets.length > 0) {
      return data.tokenLockWallets[0].address;
    } else {
      console.log(`No vesting contract found for addresses: ${beneficiaryAddresses.join(', ')}`);
      return null;
    }
  } catch (error) {
    console.error('Error fetching vesting contract address:', error);
    return null;
  }
}

async function getOwnedFanTokens(addresses: string[]): Promise<TokenHolding[] | null> {
  const graphQLClient = new GraphQLClient(MOXIE_API_URL);
  
  const query = gql`
    query MyQuery($userAddresses: [ID!]) {
      users(where: { id_in: $userAddresses }) {
        portfolio {
          balance
          buyVolume
          sellVolume
          subjectToken {
            name
            symbol
            currentPriceInMoxie
          }
        }
      }
    }
  `;
  
  try {
    const variables = { 
      userAddresses: addresses.map(addr => addr.toLowerCase()) 
    };
    
    const data = await graphQLClient.request<PortfolioResponse>(query, variables);
    console.log('Fan token data:', JSON.stringify(data, null, 2));
    
    // Filter for only the /thepod token
    const podTokens = data.users?.[0]?.portfolio?.filter(token => 
      token.subjectToken.symbol === "cid:thepod"
    ) || null;

    return podTokens;
  } catch (error) {
    console.error('Error fetching fan tokens:', error);
    return null;
  }
}

// Add new interfaces
interface FanTokenData {
  ownsToken: boolean;
  balance: number;
}

// Add function to get Farcaster addresses from FID
interface SocialsResponse {
  Socials: {
    Social: Array<{
      userAddress: string;
      userAssociatedAddresses: string[];
    }>;
  };
}

async function getFarcasterAddressesFromFID(fid: string): Promise<string[]> {
  const graphQLClient = new GraphQLClient(AIRSTACK_API_URL, {
    headers: {
      'Authorization': AIRSTACK_API_KEY,
    },
  });

  const query = gql`
    query MyQuery($identity: Identity!) {
      Socials(
        input: {
          filter: { dappName: { _eq: farcaster }, identity: { _eq: $identity } }
          blockchain: ethereum
        }
      ) {
        Social {
          userAddress
          userAssociatedAddresses
        }
      }
    }
  `;

  try {
    const variables = {
      identity: `fc_fid:${fid}`
    };

    const data = await graphQLClient.request<SocialsResponse>(query, variables);
    console.log('Airstack API response:', JSON.stringify(data, null, 2));

    const addresses = new Set<string>();

    if (data?.Socials?.Social?.[0]) {
      const social = data.Socials.Social[0];
      if (social.userAddress) {
        addresses.add(social.userAddress.toLowerCase());
      }
      if (social.userAssociatedAddresses) {
        social.userAssociatedAddresses.forEach(addr => 
          addresses.add(addr.toLowerCase())
        );
      }
    }

    const addressArray = Array.from(addresses);
    console.log('Found addresses:', addressArray);

    if (addressArray.length === 0) {
      throw new Error(`No addresses found for FID: ${fid}`);
    }

    return addressArray;
  } catch (error) {
    console.error('Error fetching Farcaster addresses from Airstack:', error);
    throw error;
  }
}

// Update checkFanTokenOwnership to handle the new token data
async function checkFanTokenOwnership(fid: string): Promise<FanTokenData> {
  try {
    const addresses = await getFarcasterAddressesFromFID(fid);
    console.log('Found addresses:', addresses);

    if (!addresses || addresses.length === 0) {
      return { ownsToken: false, balance: 0 };
    }

    const vestingAddress = await getVestingContractAddress(addresses);
    const allAddresses = vestingAddress 
      ? [...addresses, vestingAddress]
      : addresses;

    const fanTokenData = await getOwnedFanTokens(allAddresses);
    if (!fanTokenData || fanTokenData.length === 0) {
      return { ownsToken: false, balance: 0 };
    }

    const podToken = fanTokenData[0]; // Since we're already filtering for thepod in getOwnedFanTokens
    if (podToken && parseFloat(podToken.balance) > 0) {
      // Convert from wei (18 decimals) to regular number
      const balance = parseFloat(podToken.balance) / 1e18;
      console.log('Calculated balance:', balance);
      return { ownsToken: true, balance };
    }

    return { ownsToken: false, balance: 0 };
  } catch (error) {
    console.error('Error checking fan token ownership:', error);
    return { ownsToken: false, balance: 0 };
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
function handleTurn(state: GameState, useNuke: boolean = false): GameState {
  verifyCardCount(state, 'TURN_START');

  // Handle nuke card usage
  if (useNuke && state.playerNukeAvailable) {
    console.log('Player using nuke card');
    if (state.c.length <= 10) {
      const nukeVictory = {
        ...state,
        p: [...state.p, ...state.c],
        c: [],
        playerNukeAvailable: false,
        m: 'NUCLEAR VICTORY! Your nuke card destroyed all CPU cards!',
        victoryMessage: '☢️ NUCLEAR VICTORY! ☢️'
      };
      verifyCardCount(nukeVictory, 'NUKE_VICTORY');
      return nukeVictory;
    }

    const nukedCards = state.c.splice(-10);
    const nukeStrike = {
      ...state,
      p: [...state.p, ...nukedCards],
      playerNukeAvailable: false,
      m: 'NUKE CARD USED! You gained 10 cards from CPU!',
      victoryMessage: '☢️ NUCLEAR STRIKE SUCCESSFUL! ☢️'
    };
    verifyCardCount(nukeStrike, 'NUKE_STRIKE');
    return nukeStrike;
  }

  // CPU nuke logic - triggers when CPU is losing badly
  if (state.cpuNukeAvailable && state.c.length < 20 && Math.random() < 0.2) {
    console.log('CPU using nuke card');
    if (state.p.length <= 10) {
      const cpuNukeVictory = {
        ...state,
        p: [],
        c: [...state.c, ...state.p],
        cpuNukeAvailable: false,
        m: 'CPU used their NUKE CARD! You were completely destroyed!',
        victoryMessage: '☢️ NUCLEAR DEFEAT! ☢️'
      };
      verifyCardCount(cpuNukeVictory, 'CPU_NUKE_VICTORY');
      return cpuNukeVictory;
    }

    const nukedCards = state.p.splice(-10);
    const cpuNukeStrike = {
      ...state,
      c: [...state.c, ...nukedCards],
      cpuNukeAvailable: false,
      m: 'CPU used their NUKE CARD! They stole 10 of your cards!',
      victoryMessage: '☢️ NUCLEAR STRIKE RECEIVED! ☢️'
    };
    verifyCardCount(cpuNukeStrike, 'CPU_NUKE_STRIKE');
    return cpuNukeStrike;
  }

  // Continue with regular turn logic
  const moveCount = (state.moveCount || 0) + 1;
  const shouldForceWar = moveCount % 12 === 0;
  
  // Draw cardsS
  const pc = state.p.pop()!;
  const cc = state.c.pop()!;
  const forcedPc = shouldForceWar ? { ...pc, v: 10 } : pc;
  const forcedCc = shouldForceWar ? { ...cc, v: 10 } : cc;

  console.log('Turn progress:', {
    playerCard: `${getCardLabel(forcedPc.v)}${forcedPc.s}`,
    cpuCard: `${getCardLabel(forcedCc.v)}${forcedCc.s}`,
    isWar: state.w,
    forcedWar: shouldForceWar,
    deckSizes: {
      player: state.p.length,
      cpu: state.c.length,
      warPile: state.warPile?.length || 0
    }
  });

  // War resolution
  if (state.w && state.warPile) {
    const winner = forcedPc.v > forcedCc.v ? 'p' : 'c';
    const allCards = [...state.warPile, forcedPc, forcedCc];
    
    const warResolution = {
      ...state,
      pc: forcedPc,
      cc: forcedCc,
      moveCount,
      w: false,
      warPile: undefined,
      p: winner === 'p' ? [...state.p, ...allCards] : state.p,
      c: winner === 'c' ? [...state.c, ...allCards] : state.c,
      m: `${winner === 'p' ? 'You' : 'Computer'} won the WAR with ${getCardLabel(winner === 'p' ? forcedPc.v : forcedCc.v)} against ${getCardLabel(winner === 'p' ? forcedCc.v : forcedPc.v)}! (+${allCards.length} cards)`,
      victoryMessage: winner === 'p' ? '🎉 WAR VICTORY! 🎉' : '💔 WAR LOST! 💔',
      warCount: (state.warCount || 0) + 1
    };

    verifyCardCount(warResolution, 'WAR_RESOLUTION');
    console.log('War resolution:', {
      winner: winner === 'p' ? 'player' : 'cpu',
      playerCards: warResolution.p.length,
      cpuCards: warResolution.c.length,
      cardsWon: allCards.length
    });
    return warResolution;
  }

  // Check for war start
  if (forcedPc.v === forcedCc.v || shouldForceWar) {
    // Not enough cards check
    if (state.p.length < 3 || state.c.length < 3) {
      const winner = state.p.length >= state.c.length ? 'p' : 'c';
      const loserCards = winner === 'p' ? state.c : state.p;
      
      const insufficientCards = {
        ...state,
        pc: forcedPc,
        cc: forcedCc,
        moveCount,
        w: false,
        p: winner === 'p' ? [...state.p, ...loserCards, forcedPc, forcedCc] : [],
        c: winner === 'c' ? [...state.c, ...loserCards, forcedPc, forcedCc] : [],
        m: `Not enough cards for war! ${winner === 'p' ? 'You' : 'Computer'} wins all remaining cards!`,
        victoryMessage: winner === 'p' ? '🎉 War Victory! 🎉' : '💔 War Lost! 💔'
      };

      verifyCardCount(insufficientCards, 'WAR_INSUFFICIENT');
      return insufficientCards;
    }

    // Draw war cards
    const pWarCards = state.p.splice(-3).map(c => ({...c, hidden: true}));
    const cWarCards = state.c.splice(-3).map(c => ({...c, hidden: true}));
    
    const warStart = {
      ...state,
      pc: forcedPc,
      cc: forcedCc,
      moveCount,
      w: true,
      warPile: [...pWarCards, ...cWarCards],
      m: shouldForceWar ? "FORCED WAR! Place 3 cards face down..." : "WAR! Equal cards! Place 3 cards face down...",
      victoryMessage: undefined
    };

    verifyCardCount(warStart, 'WAR_START');
    return warStart;
  }

  // Normal turn
  const winner = forcedPc.v > forcedCc.v ? 'p' : 'c';
  const normalTurn = {
    ...state,
    pc: forcedPc,
    cc: forcedCc,
    moveCount,
    w: false,
    p: winner === 'p' ? [...state.p, forcedPc, forcedCc] : state.p,
    c: winner === 'c' ? [...state.c, forcedPc, forcedCc] : state.c,
    m: `${winner === 'p' ? 'You' : 'Computer'} win${winner === 'p' ? '' : 's'} with ${getCardLabel(winner === 'p' ? forcedPc.v : forcedCc.v)}!`
  };

  verifyCardCount(normalTurn, 'NORMAL_TURN');
  return normalTurn;
}

// Add the compression function
function compressState(state: GameState): string {
  // Essential game state for persistence
  const minState: GameState = {
    // Core game state
    p: state.p,
    c: state.c,
    pc: state.pc,
    cc: state.cc,
    m: state.m,
    w: state.w,
    
    // War-related state
    warPile: state.warPile,
    warCount: state.warCount || 0,
    
    // Game progress
    moveCount: state.moveCount || 0,
    lastDrawTime: state.lastDrawTime,
    
    // UI state
    username: state.username,
    victoryMessage: state.victoryMessage,
    
    // Player data
    fanTokenData: state.fanTokenData ? {
      ownsToken: state.fanTokenData.ownsToken,
      balance: state.fanTokenData.balance
    } : undefined
  };

  try {
    return Buffer.from(JSON.stringify(minState)).toString('base64');
  } catch (error) {
    console.error('State compression error:', error);
    // Fallback to minimal state if compression fails
    const fallbackState = {
      p: state.p,
      c: state.c,
      m: 'Error saving game state',
      w: false
    };
    return Buffer.from(JSON.stringify(fallbackState)).toString('base64');
  }
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
  
  // Special styling for nuke cards
  if (card.isNuke) {
    return (
      <div style={{
        ...CardStyle,
        backgroundColor: '#ff0000',  // Red background
        color: '#000000',           // Black text
        border: '2px solid #000000' // Black border for extra emphasis
      }}>
        <span style={{ fontSize: '24px' }}>NUKE</span>
        <span style={{ fontSize: '48px' }}>{card.s}</span>
        <span style={{ fontSize: '24px', transform: 'rotate(180deg)' }}>
          NUKE
        </span>
      </div>
    );
  }
  
  // Regular card styling
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
  try {
    console.log('Game frame handler started');
    const startTime = Date.now();
    
    const { buttonValue } = c;
    const fid = c.frameData?.fid;
    
    console.log('Request details:', {
      buttonValue: buttonValue ? 'exists' : 'none',
      fid: fid ? 'exists' : 'none',
      timestamp: new Date().toISOString()
    });

    // Get username and check tokens only if there's no buttonValue (new game)
    let username = 'Player';
    let fanTokenData = { ownsToken: false, balance: 0 };

    // Define styles first
    const styles = {
      root: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1080px',
        height: '1080px',
        backgroundColor: '#1a1a1a',
        color: 'white',
        padding: '40px'
      },
      gamePanel: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        padding: '40px',
        borderRadius: '10px',
        gap: '40px'
      },
      counter: {
        display: 'flex',
        gap: '40px',
        fontSize: '24px',
        color: 'white'
      },
      cardArea: {
        display: 'flex',
        alignItems: 'center',
        gap: '40px'
      },
      vsText: {
        fontSize: '36px',
        fontWeight: 'bold',
        color: 'white'
      },
      messageArea: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px'
      },
      gameMessage: (isWar: boolean) => ({
        fontSize: '32px',
        color: isWar ? '#ff4444' : 'white'
      }),
      warIndicator: {
        fontSize: '48px',
        color: '#ff4444',
        fontWeight: 'bold'
      },
      victoryMessage: {
        fontSize: '48px',
        color: '#4ADE80',
        fontWeight: 'bold',
        textAlign: 'center',
        marginTop: '20px'
      },
      fanTokenIndicator: {
        fontSize: '18px',
        color: '#4ADE80',
        marginTop: '10px',
        textAlign: 'center'
      }
    };

    if (!buttonValue && fid) {
      try {
        // Do initial checks in parallel
        const [usernameResult, tokenData] = await Promise.all([
          getUsername(fid.toString()),
          checkFanTokenOwnership(fid.toString())
        ]);
        username = usernameResult;
        fanTokenData = tokenData;
      } catch (error) {
        console.error('Error during initial game setup:', error);
      }
    } else if (buttonValue?.startsWith('draw:')) {
      // Reuse the username from state but don't check tokens again
      try {
        const encodedState = buttonValue.split(':')[1];
        const decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString());
        username = decodedState.username || 'Player';
        fanTokenData = decodedState.fanTokenData || { ownsToken: false, balance: 0 };
      } catch (error) {
        console.error('Error decoding state:', error);
      }
    }

    let state: GameState;
    if (buttonValue?.startsWith('draw:')) {
      try {
        console.log('Processing draw action');
        const encodedState = buttonValue.split(':')[1];
        const decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString());
        
        console.log('Game state before turn:', {
          playerCards: decodedState.p.length,
          cpuCards: decodedState.c.length,
          isWar: decodedState.w,
          warPileSize: decodedState.warPile?.length
        });

        if (isOnCooldown(decodedState.lastDrawTime)) {
          console.log('Cooldown active, skipping turn');
          return c.res({
            image: (
              <div style={styles.root}>
                <div style={styles.gamePanel}>
                  <span style={{
                    fontSize: '24px',
                    color: '#ff4444',
                    textAlign: 'center'
                  }}>
                    Please wait a moment before drawing again...
                  </span>
                </div>
              </div>
            ),
            intents: [
              <Button value={`draw:${buttonValue.split(':')[1]}`}>
                Draw Card
              </Button>
            ]
          });
        }

        decodedState.lastDrawTime = Date.now();
        state = handleTurn(decodedState);
        
        console.log('Game state after turn:', {
          playerCards: state.p.length,
          cpuCards: state.c.length,
          isWar: state.w,
          warPileSize: state.warPile?.length,
          message: state.m
        });

        state.username = username;
        state.fanTokenData = fanTokenData;
      } catch (error) {
        console.error('State processing error:', {
          error,
          buttonValue: buttonValue.substring(0, 100) // Log first 100 chars of button value
        });
        state = { ...initializeGame(), username, fanTokenData };
      }
    } else {
      state = { ...initializeGame(), username, fanTokenData };
    }

    const isGameOver = !state.p.length || !state.c.length;

    if (isGameOver && fid) {
      const result = state.p.length > 0 ? 'win' : 'loss';
      try {
        await updateGameStats(fid.toString(), result);
        const stats = await getGameStats(fid.toString());
        console.log(`Updated stats for FID ${fid}:`, stats);
      } catch (error) {
        console.error('Error updating game stats:', error);
      }
    }

    const endTime = Date.now();
    console.log(`Game frame handler completed in ${endTime - startTime}ms`);
    
    // Return the existing game UI
    return c.res({
      image: (
        <div style={styles.root}>
          <div style={styles.gamePanel}>
            <div style={styles.counter}>
              <span>{username}'s Cards: {state.p.length}</span>
              <span>CPU Cards: {state.c.length}</span>
            </div>

            {fanTokenData.ownsToken && (
              <span style={styles.fanTokenIndicator}>
                POD Fan Token Holder: {(fanTokenData.balance).toFixed(2)}
              </span>
            )}

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
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '20px'
              }}>
                <span style={{
                  fontSize: '32px',
                  color: state.w ? '#ff4444' : 
                        (state.m.includes('won the WAR') && state.m.includes('You')) ? '#4ADE80' : 'white',
                  textAlign: 'center'
                }}>
                  {state.m}
                </span>

                {state.w && (
                  <span style={{
                    fontSize: '48px',
                    color: '#ff4444',
                    fontWeight: 'bold',
                    textAlign: 'center'
                  }}>
                    WAR!
                  </span>
                )}

                {state.victoryMessage && (
                  <span style={{
                    fontSize: '48px',
                    color: '#4ADE80',
                    fontWeight: 'bold',
                    textAlign: 'center'
                  }}>
                    {state.victoryMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
      intents: [
        <Button 
          value={!isGameOver ? `draw:${compressState(state)}` : undefined}
          action={isGameOver ? '/' : undefined}
        >
          {isGameOver ? 'Play Again' : state.w ? 'Draw War Cards' : 'Draw Card'}
        </Button>
      ]
    });
  } catch (error) {
    console.error('Critical error in game frame handler:', error);
    // Return a graceful error message to the user
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
          <span style={{ fontSize: '24px', color: '#ff4444' }}>
            Temporary server hiccup! Please try again.
          </span>
        </div>
      ),
      intents: [
        <Button action="/game">Retry</Button>
      ]
    });
  }
});

// Add share route
app.frame('/share', async (c) => {
  const { frameData } = c;
  const fid = frameData?.fid;

  let profileImage: string | null = null;
  if (fid) {
    profileImage = await getUserProfilePicture(fid.toString());
  }

  return c.res({
    image: (
      <div style={{ backgroundColor: 'white', padding: '20px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {profileImage && (
            <img 
              src={profileImage} 
              alt="Profile" 
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '32px',
                marginBottom: '20px'
              }}
            />
          )}
          {/* Add share screen content */}
        </div>
      </div>
    ),
    intents: [
      <Button action="/game">Play Again</Button>
    ]
  });
});

export const GET = app.fetch;
export const POST = app.fetch;

function isOnCooldown(lastDrawTime: number | undefined): boolean {
  if (!lastDrawTime) return false;
  const cooldownPeriod = 1000; // 1 second cooldown
  const currentTime = Date.now();
  return currentTime - lastDrawTime < cooldownPeriod;
}

function verifyCardCount(state: GameState, location: string): boolean {
  // Calculate card counts including nuke cards
  const cardCounts = {
    playerDeck: state.p.length,
    cpuDeck: state.c.length,
    warPile: state.warPile?.length || 0,
    inPlay: (state.pc ? 1 : 0) + (state.cc ? 1 : 0)
  };
  
  const totalCards = Object.values(cardCounts).reduce((sum, count) => sum + count, 0);
  const expectedCards = 54; // 52 regular cards + 2 nuke cards

  // Enhanced validation
  const isValid = totalCards === expectedCards;

  // Detailed state logging
  console.log(`🃏 ${location}:`, {
    total: totalCards,
    breakdown: cardCounts,
    gameState: {
      isWar: state.w,
      moveCount: state.moveCount || 0,
      nukeStatus: {
        playerNukeAvailable: state.playerNukeAvailable,
        cpuNukeAvailable: state.cpuNukeAvailable
      }
    }
  });

  if (!isValid) {
    console.error(`❌ Card count error at ${location}:`, {
      total: totalCards,
      expected: expectedCards,
      missing: expectedCards - totalCards,
      breakdown: cardCounts,
      message: state.m,
      nukeStatus: {
        player: state.playerNukeAvailable,
        cpu: state.cpuNukeAvailable
      },
      warState: state.w,
      moveCount: state.moveCount || 0
    });
    
    if (process.env.NODE_ENV === 'development') {
      throw new Error(`Invalid card count at ${location}: ${totalCards} (expected ${expectedCards})`);
    }
  }

  return isValid;
}