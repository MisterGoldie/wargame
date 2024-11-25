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
type Card = {
  v: number;
  s: string;
  hidden?: boolean;
  isNuke?: boolean;
};

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
  playerNukeAvailable: boolean;
  cpuNukeAvailable: boolean;
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
  const deck = shuffle(createRegularDeck()); // Only 52 cards
  const midpoint = Math.floor(deck.length / 2);
  
  return {
    p: deck.slice(0, midpoint),
    c: deck.slice(midpoint),
    pc: null,
    cc: null,
    m: 'Welcome to War! Draw a card to begin. You have one nuke ability!',
    w: false,
    lastDrawTime: Date.now(),
    playerNukeAvailable: true,
    cpuNukeAvailable: true,
    moveCount: 0,
    warCount: 0
  };
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

// API Cache interface
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  attempts: number;
}

// Global cache with type safety
const API_CACHE = new Map<string, CacheEntry<TokenHolding[] | null>>();

async function getOwnedFanTokens(addresses: string[]): Promise<TokenHolding[] | null> {
  const cacheKey = addresses.sort().join(',');
  const cacheDuration = 60 * 1000; // 1 minute cache
  const maxAttempts = 5; // Rate limit threshold
  
  const cachedEntry = API_CACHE.get(cacheKey);
  const now = Date.now();
  
  // Check cache validity
  if (cachedEntry) {
    const isValid = (now - cachedEntry.timestamp) < cacheDuration;
    const isRateLimited = cachedEntry.attempts >= maxAttempts;
    
    if (isValid && (isRateLimited || cachedEntry.data !== null)) {
      console.log('Using cached fan token data:', {
        age: Math.round((now - cachedEntry.timestamp) / 1000) + 's',
        attempts: cachedEntry.attempts
      });
      return cachedEntry.data;
    }
  }

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
    
    // Process and cache response
    const podTokens = data.users?.[0]?.portfolio?.filter(token => 
      token.subjectToken.symbol === "cid:thepod"
    ) || null;

    API_CACHE.set(cacheKey, {
      data: podTokens,
      timestamp: now,
      attempts: 0
    });

    return podTokens;
  } catch (error) {
    console.error('Fan token fetch error:', error);
    
    // Update cache with attempt count
    if (cachedEntry) {
      API_CACHE.set(cacheKey, {
        ...cachedEntry,
        attempts: cachedEntry.attempts + 1
      });
      
      if (typeof error === 'object' && error !== null && 'response' in error && (error as any).response?.status === 429 && cachedEntry.data !== null) {
        console.log('Rate limited, using cached data');
        return cachedEntry.data;
      }
    }
    
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
function handleNukeUse(state: GameState): GameState {
  console.log('Processing player nuke use');
  
  const nukeCard: Card = { 
    v: 10,
    s: '♦',
    isNuke: true
  };
  
  let newState: GameState;
  
  // Handle instant win case
  if (state.c.length <= 10) {
    newState = {
      ...state,
      p: [...state.p, ...state.c],
      c: [],
      pc: nukeCard,
      cc: null,
      playerNukeAvailable: false,
      moveCount: (state.moveCount || 0) + 1,
      lastDrawTime: Date.now(),
      m: 'NUCLEAR VICTORY! Your nuke completely destroyed CPU\'s forces!',
      victoryMessage: '☢️ NUCLEAR VICTORY! ☢️'
    };
    verifyCardCount(newState, 'NUKE_INSTANT_WIN');
    return newState;
  }

  // Take 10 cards with nuke
  const nukedCards = state.c.splice(-10);
  
  // Continue with a normal turn after showing nuke
  if (state.p.length > 0 && state.c.length > 0) {
    const pc = state.p.pop()!;
    const cc = state.c.pop()!;
    const winner = pc.v > cc.v ? 'p' : 'c';
    
    newState = {
      ...state,
      p: [...state.p, ...nukedCards, ...(winner === 'p' ? [pc, cc] : [])],
      c: [...state.c, ...(winner === 'c' ? [pc, cc] : [])],
      pc: nukeCard,
      cc,
      playerNukeAvailable: false,
      moveCount: (state.moveCount || 0) + 1,
      lastDrawTime: Date.now(),
      m: `Nuke stole 10 cards! Then ${winner === 'p' ? 'you' : 'CPU'} won with ${getCardLabel(winner === 'p' ? pc.v : cc.v)}!`,
      victoryMessage: '☢️ NUCLEAR STRIKE SUCCESSFUL! ☢️'
    };
    verifyCardCount(newState, 'NUKE_WITH_TURN');
    return newState;
  }

  newState = {
    ...state,
    p: [...state.p, ...nukedCards],
    pc: nukeCard,
    cc: null,
    playerNukeAvailable: false,
    moveCount: (state.moveCount || 0) + 1,
    lastDrawTime: Date.now(),
    m: 'NUKE USED! You captured 10 enemy cards!',
    victoryMessage: '☢️ NUCLEAR STRIKE SUCCESSFUL! ☢️'
  };
  verifyCardCount(newState, 'NUKE_ONLY');
  return newState;
}

function handleCpuNuke(state: GameState): GameState {
  console.log('Processing CPU nuke use');
  
  const nukeCard: Card = { v: 0, s: '☢️', isNuke: true };
  let newState: GameState;
  
  if (state.p.length <= 10) {
    newState = {
      ...state,
      p: [],
      c: [...state.c, ...state.p],
      pc: null,
      cc: nukeCard,
      cpuNukeAvailable: false,
      moveCount: (state.moveCount || 0) + 1,
      lastDrawTime: Date.now(),
      m: 'NUCLEAR VICTORY! CPU\'s nuke completely destroyed your forces!',
      victoryMessage: '☢️ NUCLEAR VICTORY! ☢️'
    };
    verifyCardCount(newState, 'CPU_NUKE_INSTANT_WIN');
    return newState;
  }

  const nukedCards = state.p.splice(-10);
  if (state.p.length > 0 && state.c.length > 0) {
    const pc = state.p.pop()!;
    const cc = state.c.pop()!;
    const winner = pc.v > cc.v ? 'p' : 'c';
    
    newState = {
      ...state,
      p: [...state.p, ...nukedCards, ...(winner === 'p' ? [pc, cc] : [])],
      c: [...state.c, ...(winner === 'c' ? [pc, cc] : [])],
      pc,  // Show regular card after nuke
      cc,
      cpuNukeAvailable: false,
      moveCount: (state.moveCount || 0) + 1,
      lastDrawTime: Date.now(),
      m: `CPU Nuke stole 10 cards! Then ${winner === 'p' ? 'you' : 'CPU'} won with ${getCardLabel(winner === 'p' ? pc.v : cc.v)}!`,
      victoryMessage: '☢️ NUCLEAR STRIKE SUCCESSFUL! ☢️'
    };
    verifyCardCount(newState, 'CPU_NUKE_WITH_TURN');
    return newState;
  }

  newState = {
    ...state,
    p: [...state.p, ...nukedCards],
    pc: null,
    cc: nukeCard,
    cpuNukeAvailable: false,
    moveCount: (state.moveCount || 0) + 1,
    lastDrawTime: Date.now(),
    m: 'CPU Nuke used! You captured 10 enemy cards!',
    victoryMessage: '☢️ NUCLEAR STRIKE SUCCESSFUL! ☢️'
  };
  verifyCardCount(newState, 'CPU_NUKE_ONLY');
  return newState;
}

function handleNormalTurn(state: GameState, pc: Card, cc: Card): GameState {
  const winner = pc.v > cc.v ? 'p' : 'c';
  const normalTurn = {
    ...state,
    pc,
    cc,
    moveCount: (state.moveCount || 0) + 1,
    lastDrawTime: Date.now(),
    w: false,
    p: winner === 'p' ? [...state.p, pc, cc] : state.p,
    c: winner === 'c' ? [...state.c, pc, cc] : state.c,
    m: `${winner === 'p' ? 'You' : 'Computer'} win${winner === 'p' ? '' : 's'} with ${getCardLabel(winner === 'p' ? pc.v : cc.v)}!`
  };
  verifyCardCount(normalTurn, 'NORMAL_TURN');
  return normalTurn;
}

// Add the compression function
function compressState(state: GameState): string {
  const minState: GameState = {
    ...state,
    playerNukeAvailable: state.playerNukeAvailable,
    cpuNukeAvailable: state.cpuNukeAvailable
  };
  
  try {
    return Buffer.from(JSON.stringify(minState)).toString('base64');
  } catch (error) {
    console.error('State compression error:', error);
    return Buffer.from(JSON.stringify({
      ...initializeGame(),
      m: 'Error saving game state'
    })).toString('base64');
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
  
  if (card.isNuke) {
    return (
      <div style={{
        ...CardStyle,
        backgroundColor: '#FF4444',
        color: 'white',
        border: '2px solid #FF0000'
      }}>
        <span style={{ fontSize: '24px' }}>NUKE</span>
        <span style={{ fontSize: '48px' }}>☢️</span>
        <span style={{ fontSize: '24px', transform: 'rotate(180deg)' }}>
          NUKE
        </span>
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

// Update styles object with new UI elements
const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    width: '1080px',
    height: '1080px',
    backgroundColor: '#1a1a1a',
    padding: '40px'
  },
  gamePanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px'
  },
  cooldownMessage: {
    fontSize: '24px',
    color: '#ff4444',
    textAlign: 'center'
  },
  errorMessage: {
    fontSize: '24px',
    color: '#ff4444',
    textAlign: 'center'
  },
  counter: {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
    padding: '10px 20px',
    color: 'white',
    fontSize: '24px'
  },
  fanTokenIndicator: {
    color: '#4ADE80',
    fontSize: '20px',
    marginBottom: '10px'
  },
  cardArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    marginBottom: '20px'
  },
  vsText: {
    color: 'white',
    fontSize: '32px',
    margin: '0 20px'
  },
  messageArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px'
  },
  gameMessage: (isWar: boolean) => ({
    fontSize: '32px',
    color: isWar ? '#ff4444' : 'white',
    textAlign: 'center' as const
  }),
  victoryMessage: {
    fontSize: '48px',
    color: '#4ADE80',
    fontWeight: 'bold',
    textAlign: 'center' as const
  }
} as const;

// Update handleTurn to actually implement the logic instead of throwing
function handleTurn(state: GameState, useNuke: boolean = false): GameState {
  verifyCardCount(state, 'TURN_START');
  const moveCount = (state.moveCount || 0) + 1;
  
  if (useNuke) {
    return handleNukeUse(state);
  }

  if (!state.p.length || !state.c.length) {
    return {
      ...state,
      m: `Game Over! ${!state.c.length ? 'You' : 'CPU'} wins!`,
      victoryMessage: !state.c.length ? '🎉 Victory! 🎉' : '💔 Defeat! 💔'
    };
  }

  const pc = state.p.pop()!;
  const cc = state.c.pop()!;

  // Check for CPU nuke opportunity
  if (state.cpuNukeAvailable && state.c.length < 15 && Math.random() < 0.3) {
    state.p.push(pc);
    state.c.push(cc);
    return handleCpuNuke(state);
  }

  // Check for war
  if (pc.v === cc.v) {
    // Handle war logic
    if (state.p.length < 3 || state.c.length < 3) {
      const winner = state.p.length >= state.c.length ? 'p' : 'c';
      return {
        ...state,
        pc,
        cc,
        p: winner === 'p' ? [...state.p, pc, cc] : [],
        c: winner === 'c' ? [...state.c, pc, cc] : [],
        w: false,
        m: `Not enough cards for war! ${winner === 'p' ? 'You' : 'Computer'} wins!`,
        victoryMessage: winner === 'p' ? '🎉 Victory! 🎉' : '💔 Defeat! 💔'
      };
    }

    const pWarCards = state.p.splice(-3).map(c => ({...c, hidden: true}));
    const cWarCards = state.c.splice(-3).map(c => ({...c, hidden: true}));

    return {
      ...state,
      pc,
      cc,
      w: true,
      warPile: [...pWarCards, ...cWarCards],
      m: 'WAR! Three cards face down...',
      moveCount,
      lastDrawTime: Date.now(),
      warCount: (state.warCount || 0) + 1
    };
  }

  return handleNormalTurn(state, pc, cc);
}

// Update game frame handler with new UI
app.frame('/game', async (c) => {
  try {
    const { buttonValue } = c;
    const fid = c.frameData?.fid;
    
    let state: GameState;
    let username = 'Player';
    let fanTokenData = { ownsToken: false, balance: 0 };

    // Handle initial load
    if (!buttonValue && fid) {
      try {
        const [usernameResult, tokenData] = await Promise.all([
          getUsername(fid.toString()),
          checkFanTokenOwnership(fid.toString())
        ]);
        username = usernameResult;
        fanTokenData = tokenData;
      } catch (error) {
        console.error('Error during initial game setup:', error);
      }
      state = { ...initializeGame(), username, fanTokenData };
    } 
    // Handle button actions
    else if (buttonValue?.startsWith('draw:') || buttonValue?.startsWith('nuke:')) {
      const encodedState = buttonValue.split(':')[1];
      const decodedState = JSON.parse(Buffer.from(encodedState, 'base64').toString());
      
      if (isOnCooldown(decodedState.lastDrawTime)) {
        return c.res({
          image: (
            <div style={styles.root}>
              <div style={styles.gamePanel}>
                <span style={styles.cooldownMessage}>
                  Please wait a moment...
                </span>
              </div>
            </div>
          ),
          intents: [
            <Button value={buttonValue}>
              {buttonValue.startsWith('nuke:') ? 'Use Nuke ☢️' : 'Draw Card'}
            </Button>
          ]
        });
      }

      username = decodedState.username || 'Player';
      fanTokenData = decodedState.fanTokenData || { ownsToken: false, balance: 0 };
      
      state = handleTurn(decodedState, buttonValue.startsWith('nuke:'));
      state.username = username;
      state.fanTokenData = fanTokenData;
    } else {
      state = { ...initializeGame(), username, fanTokenData };
    }

    const isGameOver = !state.p.length || !state.c.length;

    // Update game stats if game is over
    if (isGameOver && fid) {
      try {
        const result = state.p.length > 0 ? 'win' : 'loss';
        await updateGameStats(fid.toString(), result);
        const stats = await getGameStats(fid.toString());
        
        // Add stats to victory message
        state.victoryMessage = `${state.victoryMessage || ''}\nTotal Games: ${stats.gamesPlayed} | Wins: ${stats.wins}`;
      } catch (error) {
        console.error('Error handling game stats:', error);
      }
    }

    // Use your existing UI components
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
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ color: '#4ADE80', fontSize: '24px' }}>{username}</span>
                    <GameCard card={state.pc} />
                  </div>
                  
                  <span style={styles.vsText}>VS</span>
                  
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ color: '#ff4444', fontSize: '24px' }}>CPU</span>
                    <GameCard card={state.cc} />
                  </div>
                </>
              ) : (
                <span style={{ fontSize: '24px', color: 'white' }}>
                  Draw a card to begin!
                </span>
              )}
            </div>

            <div style={styles.messageArea}>
              <span style={styles.gameMessage(state.w)}>
                {state.m}
              </span>
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
        state.playerNukeAvailable && !isGameOver && (
          <Button value={`nuke:${compressState(state)}`}>Use Nuke ☢️</Button>
        ),
        !isGameOver && (
          <Button value={`draw:${compressState(state)}`}>
            {state.w ? 'Draw War Cards' : 'Draw Card'}
          </Button>
        ),
        isGameOver && <Button action="/">Play Again</Button>
      ].filter(Boolean)
    });
  } catch (error) {
    console.error('Critical error in game frame handler:', error);
    return c.res({
      image: (
        <div style={styles.root}>
          <span style={styles.errorMessage}>
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