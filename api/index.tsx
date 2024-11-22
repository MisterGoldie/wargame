/** @jsxImportSource frog/jsx */

import { Button, Frog } from 'frog'
import type { NeynarVariables } from 'frog/middlewares'
import { neynar } from 'frog/middlewares'
import { GraphQLClient, gql } from 'graphql-request'

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
async function getFarcasterAddressesFromFID(fid: string): Promise<string[]> {
  const graphQLClient = new GraphQLClient(AIRSTACK_API_URL, {
    headers: {
      'Authorization': AIRSTACK_API_KEY,
    },
  });

  const query = gql`
    query GetAddresses($identity: Identity!) {
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

    const data = await graphQLClient.request<any>(query, variables);
    console.log('Airstack API response:', JSON.stringify(data, null, 2));

    // Collect unique addresses
    const addresses = new Set<string>();

    if (data?.Socials?.Social?.[0]) {
      const social = data.Socials.Social[0];
      if (social.userAddress) {
        addresses.add(social.userAddress.toLowerCase());
      }
      if (social.userAssociatedAddresses) {
        social.userAssociatedAddresses.forEach((addr: string) => 
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
function handleTurn(state: GameState): GameState {
  // Game over check
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

  // War resolution
  if (state.w) {
    const allCards = [...cards, ...(state.warPile || [])];
    const winner = pc.v > cc.v ? 'p' : 'c';
    
    const newState = {
      ...state,
      pc, cc,
      w: false,
      m: '', // Clear the war message
      victoryMessage: winner === 'p' 
        ? `You won the WAR with ${getCardLabel(pc.v)}!` 
        : `CPU won the WAR with ${getCardLabel(cc.v)}!`,
      warPile: []
    };

    // Winner takes all cards
    if (winner === 'p') {
      newState.p.unshift(...allCards);
    } else {
      newState.c.unshift(...allCards);
    }

    return newState;
  }

  // Check for new war
  if (pc.v === cc.v) {
    // Check if enough cards for war
    if (state.p.length < 3 || state.c.length < 3) {
      const winner = state.p.length > state.c.length ? 'p' : 'c';
      return {
        ...state,
        pc, cc,
        w: false,
        m: `Not enough cards for war! ${winner === 'p' ? 'You win!' : 'Computer wins!'}`,
        victoryMessage: undefined
      };
    }

    // Draw face-down cards
    const pWarCards = state.p.splice(-3);
    const cWarCards = state.c.splice(-3);
    
    return {
      ...state,
      pc, cc,
      w: true,
      warPile: [
        ...cards,
        ...pWarCards.map(c => ({...c, hidden: true})),
        ...cWarCards.map(c => ({...c, hidden: true}))
      ],
      m: "WAR! 3 cards face down, next card decides the winner!",
      victoryMessage: undefined // Clear any previous victory message
    };
  }

  // Normal turn resolution
  const winner = pc.v > cc.v ? 'p' : 'c';
  const newState = {
    ...state,
    pc, cc,
    w: false,
    victoryMessage: undefined // Clear any previous victory message
  };

  if (winner === 'p') {
    newState.p.unshift(...cards);
    newState.m = `You win with ${getCardLabel(pc.v)}!`;
  } else {
    newState.c.unshift(...cards);
    newState.m = `Computer wins with ${getCardLabel(cc.v)}!`;
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
  const { buttonValue, frameData } = c;
  const fid = frameData?.fid;

  // Get username and check fan token ownership in parallel
  const [username, fanTokenData] = await Promise.all([
    fid ? getUsername(fid.toString()) : Promise.resolve('Player'),
    fid ? checkFanTokenOwnership(fid.toString()) : Promise.resolve({ ownsToken: false, balance: 0 })
  ]);

  // Add fan token indicator to the game panel if user owns tokens
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
    },

    fanTokenIndicator: {
      fontSize: '18px',
      color: '#4ADE80',
      marginTop: '10px',
      textAlign: 'center'
    }
  };

  let state: GameState;
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
                color: state.w ? '#ff4444' : 'white',
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
        value={!isGameOver ? `draw:${Buffer.from(JSON.stringify(state)).toString('base64')}` : undefined}
        action={isGameOver ? '/' : undefined}
      >
        {isGameOver ? 'Play Again' : state.w ? 'Draw War Cards' : 'Draw Card'}
      </Button>
    ]
  });
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
