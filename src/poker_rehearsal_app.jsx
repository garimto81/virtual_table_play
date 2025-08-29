import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, runTransaction } from 'firebase/firestore';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';

// --- Firebase Configuration ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : { apiKey: "YOUR_API_KEY", authDomain: "YOUR_AUTH_DOMAIN", projectId: "YOUR_PROJECT_ID" };
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'poker-rehearsal-default';
const SESSION_ID = 'live-session'; // Fixed ID for the single live session

// --- Helper Components ---
const Card = ({ suit, rank, isFaceDown = false, onClick = () => {}, size = 'director' }) => {
    const sizes = {
        director: "w-16 h-24 text-2xl",
        player: "w-[45vw] h-[63vw] sm:w-auto sm:h-[80vh] sm:aspect-[5/7]",
        dealer: "w-[18vw] h-[25vw] sm:w-auto sm:h-[60vh] sm:aspect-[5/7]"
    };
    const fontSizes = {
        director: "text-2xl",
        player: "text-[6vw] sm:text-[10vh]",
        dealer: "text-[2.5vw] sm:text-[8vh]"
    };
    const suitFontSizes = {
        director: "text-4xl",
        player: "text-[8vw] sm:text-[15vh]",
        dealer: "text-[4vw] sm:text-[12vh]"
    };

    const sizeClasses = sizes[size] || sizes['director'];
    const fontClasses = fontSizes[size] || fontSizes['director'];
    const suitFontClasses = suitFontSizes[size] || suitFontSizes['director'];

    if (isFaceDown) {
        return <div onClick={onClick} className={`${sizeClasses} bg-blue-800 rounded-xl shadow-md border-2 border-blue-900 flex items-center justify-center cursor-pointer`}><div className="w-[85%] h-[90%] border-2 border-blue-500 rounded-lg"></div></div>;
    }
    const isRed = suit === '♥' || suit === '♦';
    return (
        <div onClick={onClick} className={`${sizeClasses} bg-white rounded-xl shadow-lg flex flex-col justify-between items-center p-2 border-2 border-gray-300 cursor-pointer ${isRed ? 'text-red-600' : 'text-black'}`}>
            <span className={`${fontClasses} font-bold self-start`}>{rank}</span>
            <span className={suitFontClasses}>{suit}</span>
            <span className={`${fontClasses} font-bold self-end transform rotate-180`}>{rank}</span>
        </div>
    );
};


// --- Data ---
const handScenarios = [
    { title: "필연적인 충돌 (AA vs KK)", hands: [{ role: "NP", cards: ["A♠", "A♥"] }, { role: "OP", cards: ["K♠", "K♥"] }], board: ["9♦", "7♣", "2♥", "5♠", "Q♣"] },
    { title: "셋 오버 셋 (Set over Set)", hands: [{ role: "NP", cards: ["8♠", "8♦"] }, { role: "OP", cards: ["3♠", "3♣"] }], board: ["A♥", "8♣", "3♦", "K♠", "2♥"] },
    { title: "역전의 강 (Flush vs Full House)", hands: [{ role: "NP", cards: ["A♠", "K♠"] }, { role: "OP", cards: ["7♦", "7♥"] }], board: ["K♦", "7♠", "2♠", "Q♣", "7♣"] },
];
const cameraRules = [
    { id: 1, title: "인접/근접 대결", condition: (np, op) => Math.min(Math.abs(np - op), 9 - Math.abs(np - op)) <= 2, mainCam: "그룹 샷 (NP와 OP를 함께 촬영)", subCam: "보드 샷" },
    { id: 2, title: "원거리 대결", condition: (np, op) => true, mainCam: "NP A컷 (NP만 타이트하게 촬영)", subCam: "상대방 + 보드 샷" },
    { id: 3, title: "원거리 대결 (샷 중첩)", condition: (np, op) => true, mainCam: "그룹 샷 (NP와 OP를 함께 촬영)", subCam: "보드 샷", note: "서브캠에 NP가 걸리는 경우, 즉시 이 워크플로우로 전환." }
];

// --- Director View ---
const DirectorView = ({ db, setMode }) => {
    const [numPlayers, setNumPlayers] = useState(3);
    const [scenario, setScenario] = useState(null);
    const sessionDocRef = doc(db, "artifacts", appId, "public", "data", "rehearsals", SESSION_ID);

    useEffect(() => {
        const initializeSession = async () => {
             await setDoc(sessionDocRef, {
                isActive: true,
                claimedRoles: { '1': null, '2': null, '3': null, '4': null, '5': null, '6': null, '7': null, '8': null, '9': null, 'dealer': null },
                scenario: null,
            });
        };
        initializeSession();

        const unsubscribe = onSnapshot(sessionDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setScenario(docSnap.data().scenario);
            }
        });

        return () => unsubscribe();
    }, []);

    const handleGenerateScenario = async () => {
        const suits = ['♠', '♥', '♦', '♣'];
        const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        let deck = suits.flatMap(suit => ranks.map(rank => rank + suit));
        
        const randomHandScenario = handScenarios[Math.floor(Math.random() * handScenarios.length)];
        const mainCards = randomHandScenario.hands.flatMap(h => h.cards);
        let remainingDeck = deck.filter(card => !mainCards.includes(card)).sort(() => 0.5 - Math.random());

        const seats = Array.from({ length: 9 }, (_, i) => i + 1).sort(() => 0.5 - Math.random());
        const activeSeats = seats.slice(0, numPlayers);
        const npPosition = activeSeats[0];
        const opPositions = activeSeats.slice(1);

        const finalHands = [], playerHandsMap = {};
        finalHands.push({ role: "NP", cards: randomHandScenario.hands[0].cards, position: npPosition });
        playerHandsMap[npPosition] = randomHandScenario.hands[0].cards;
        if (opPositions.length > 0) {
            finalHands.push({ role: "OP", cards: randomHandScenario.hands[1].cards, position: opPositions[0] });
            playerHandsMap[opPositions[0]] = randomHandScenario.hands[1].cards;
        }
        for (let i = 1; i < opPositions.length; i++) {
            const hand = [remainingDeck.pop(), remainingDeck.pop()];
            finalHands.push({ role: "OP", cards: hand, position: opPositions[i] });
            playerHandsMap[opPositions[i]] = hand;
        }

        const distance = opPositions.length > 0 ? Math.min(Math.abs(npPosition - opPositions[0]), 9 - Math.abs(npPosition - opPositions[0])) : 0;
        let selectedRuleObject = distance <= 2 ? cameraRules[0] : (Math.random() < 0.6 ? cameraRules[1] : cameraRules[2]);
        const { condition, ...serializableRule } = selectedRuleObject;

        const fullScenario = {
            handInfo: { title: randomHandScenario.title, board: randomHandScenario.board, hands: finalHands.sort((a, b) => a.position - b.position) },
            positions: { np: npPosition, op: opPositions, all: activeSeats },
            rule: serializableRule,
            gameState: { boardState: 'pre-deal' },
            playerHands: playerHandsMap,
            numPlayers,
        };
        
        await updateDoc(sessionDocRef, { scenario: fullScenario });
    };
    
    const parseCard = (cardStr) => ({ rank: cardStr.slice(0, -1), suit: cardStr.slice(-1) });

    return (
        <div className="p-4 sm:p-8">
            <button onClick={() => setMode('select')} className="absolute top-4 left-4 text-gray-600 hover:text-gray-800">&larr; 역할 선택으로</button>
            <h1 className="text-3xl font-bold text-center">감독 모드 (관전)</h1>
            {!scenario ? (
                <div className="bg-white p-6 rounded-xl shadow-lg mt-4 max-w-md mx-auto">
                    <h2 className="text-xl font-bold mb-2 text-gray-700">리허설 대기중...</h2>
                    <p className="text-sm text-gray-500 mb-4">참여 인원을 설정하고 첫 시나리오를 생성하여 세션을 시작하세요. 다른 참여자들이 역할 선택 화면에서 대기중입니다.</p>
                    <div>
                        <label htmlFor="numPlayers" className="block text-md font-medium text-gray-600">참여 인원: <span className="font-bold text-blue-600 text-lg">{numPlayers}</span>명</label>
                        <input id="numPlayers" type="range" min="2" max="9" value={numPlayers} onChange={(e) => setNumPlayers(parseInt(e.target.value, 10))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer mt-2"/>
                    </div>
                    <button onClick={handleGenerateScenario} className="w-full mt-4 bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors">첫 시나리오 생성 & 세션 시작</button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-6">
                         <div className="bg-white p-4 rounded-xl shadow-lg">
                            <h3 className="text-lg font-bold mb-2">📋 핸드 정보: {scenario.handInfo.title}</h3>
                            <div className="space-y-3">
                                {scenario.handInfo.hands.map(hand => (
                                    <div key={hand.position}>
                                        <p className="font-semibold">{hand.role} (#{hand.position})</p>
                                        <div className="flex space-x-2"><Card {...parseCard(hand.cards[0])} /><Card {...parseCard(hand.cards[1])} /></div>
                                    </div>
                                ))}
                            </div>
                             <div className="mt-4 border-t pt-4">
                                <h3 className="font-semibold mb-2">마스터 보드 (항상 공개)</h3>
                                <div className="flex flex-wrap gap-2">
                                    {scenario.handInfo.board.map(cardStr => <Card key={cardStr} {...parseCard(cardStr)} />)}
                                </div>
                            </div>
                        </div>
                         <div className="bg-white p-4 rounded-xl shadow-lg">
                            <h3 className="text-lg font-bold mb-2">🎥 카메라 워크플로우</h3>
                             <div className="bg-gray-50 p-3 rounded-lg border">
                                <p className="font-bold text-blue-600">{scenario.rule.title}</p>
                                <p className="text-sm"><strong className="text-gray-600">메인 캠:</strong> {scenario.rule.mainCam}</p>
                                <p className="text-sm"><strong className="text-gray-600">서브 캠:</strong> {scenario.rule.subCam}</p>
                                {scenario.rule.note && <p className="text-xs text-red-600 mt-1"><strong>참고:</strong> {scenario.rule.note}</p>}
                            </div>
                             <div className="mt-8 border-t pt-4">
                                <button onClick={handleGenerateScenario} className="w-full bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700">다음 시나리오 생성</button>
                             </div>
                         </div>
                    </div>
                </>
            )}
        </div>
    );
};

// --- Role Selection / Lobby View ---
const RoleSelectionScreen = ({ db, auth, onRoleSelect, setMode, mode }) => {
    const [sessionState, setSessionState] = useState(null);
    const [error, setError] = useState('');
    const sessionDocRef = doc(db, "artifacts", appId, "public", "data", "rehearsals", SESSION_ID);

    useEffect(() => {
        const unsubscribe = onSnapshot(sessionDocRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().isActive) {
                setSessionState(docSnap.data());
            } else {
                setSessionState(null);
                setError('현재 활성화된 리허설 세션이 없습니다. 감독이 세션을 시작할 때까지 기다려주세요.');
            }
        });
        return () => unsubscribe();
    }, []);
    
    useEffect(() => {
        if (mode === 'dealer' && sessionState) {
            handleSelectRole('dealer');
        }
    }, [mode, sessionState]);

    const handleSelectRole = async (roleId) => {
        if (!sessionState) {
            setError('세션이 아직 준비되지 않았습니다.');
            return;
        }
        try {
            await runTransaction(db, async (transaction) => {
                const sessionDoc = await transaction.get(sessionDocRef);
                if (!sessionDoc.exists()) throw new Error("세션을 찾을 수 없습니다.");
                
                const claimedRoles = sessionDoc.data().claimedRoles;
                if (claimedRoles[roleId] && claimedRoles[roleId] !== auth.currentUser.uid) {
                    setError("이미 다른 사람이 선택한 역할입니다.");
                    return;
                }
                
                const userId = auth.currentUser.uid;
                for (const role in claimedRoles) {
                    if (claimedRoles[role] === userId) {
                        claimedRoles[role] = null;
                    }
                }

                claimedRoles[roleId] = userId;
                transaction.update(sessionDocRef, { claimedRoles });
                onRoleSelect(roleId);
            });
        } catch (e) {
            console.error("역할 선택 실패:", e);
            setError("역할 선택에 실패했습니다. 다시 시도해주세요.");
        }
    };
    
    const seatPositions = [
        { number: 1, x: '25%', y: '85%' }, { number: 2, x: '5%', y: '50%' }, { number: 3, x: '15%', y: '15%' },
        { number: 4, x: '35%', y: '0%' }, { number: 5, x: '50%', y: '0%' }, { number: 6, x: '65%', y: '0%' },
        { number: 7, x: '85%', y: '15%' }, { number: 8, x: '95%', y: '50%' }, { number: 9, x: '75%', y: '85%' },
    ];
    
    if (!sessionState) {
        return <div className="flex flex-col items-center justify-center min-h-screen"><p className="text-lg text-center p-4">{error || "세션 정보를 불러오는 중..."}</p><button onClick={() => setMode('select')} className="mt-4 text-sm text-blue-500 hover:underline">뒤로가기</button></div>;
    }
    
    if (mode === 'dealer') {
        return <div className="flex flex-col items-center justify-center min-h-screen"><p className="text-lg">딜러 역할로 참여하는 중...</p>{error && <p className="mt-2 text-red-600">{error}</p>}<button onClick={() => setMode('select')} className="mt-4 text-sm text-blue-500 hover:underline">뒤로가기</button></div>;
    }
    
    const activeSeats = sessionState.scenario?.positions?.all || [];

    return (
        <div className="p-4">
             <button onClick={() => setMode('select')} className="absolute top-4 left-4 text-gray-600 hover:text-gray-800">&larr; 역할 선택으로</button>
            <h1 className="text-2xl font-bold text-center mb-4">좌석 선택 (로비)</h1>
            <p className="text-center text-gray-600 mb-8">{sessionState.scenario ? '참여할 좌석을 선택하세요.' : '감독이 시나리오를 생성하고 참여 인원을 확정할 때까지 기다려주세요.'}</p>
            <div className="relative w-full max-w-xl h-72 mx-auto">
                <div className="absolute inset-0 bg-green-800 rounded-[35%] border-8 border-yellow-800"></div>
                {seatPositions.map(seat => {
                    const roleId = seat.number;
                    const isClaimed = !!sessionState.claimedRoles[roleId];
                    const isMe = sessionState.claimedRoles[roleId] === auth.currentUser.uid;
                    const isActive = activeSeats.includes(roleId);

                    let seatClass = "bg-gray-500 opacity-50";
                    if (isMe) {
                        seatClass = "bg-purple-600";
                    } else if (isClaimed) {
                        seatClass = "bg-gray-700 opacity-70";
                    } else if (isActive) {
                        seatClass = "bg-blue-500 hover:bg-blue-700";
                    }

                    return (
                        <button key={roleId} onClick={() => handleSelectRole(roleId)} disabled={!isActive || (isClaimed && !isMe)}
                            style={{ left: seat.x, top: seat.y, transform: 'translate(-50%, -50%)' }}
                            className={`absolute w-16 h-16 rounded-full flex items-center justify-center font-bold text-white shadow-lg transition-all ${!isActive || (isClaimed && !isMe) ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                            <div className={`w-full h-full rounded-full flex items-center justify-center ${seatClass}`}>
                                {isMe ? "나" : `#${roleId}`}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

// --- Player & Dealer Views ---
const LiveView = ({ db, auth, mode, roleId, onLeave }) => {
    const [rehearsalState, setRehearsalState] = useState(null);
    const [error, setError] = useState('');
    const [cardFlipState, setCardFlipState] = useState({ card1: false, card2: false });
    const sessionDocRef = doc(db, "artifacts", appId, "public", "data", "rehearsals", SESSION_ID);

    useEffect(() => {
        const unsubscribe = onSnapshot(sessionDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                 if (rehearsalState && rehearsalState.scenario?.gameState.boardState !== 'pre-deal' && data.scenario?.gameState.boardState === 'pre-deal') {
                    setCardFlipState({ card1: false, card2: false });
                }
                setRehearsalState(data);
                setError('');
            } else {
                setError("리허설이 종료되었습니다.");
                setRehearsalState(null);
            }
        });
        return () => unsubscribe();
    }, []);
    
    const handleLeaveClick = async () => {
         await runTransaction(db, async (transaction) => {
            const sessionDoc = await transaction.get(sessionDocRef);
            if (!sessionDoc.exists()) return;
            const claimedRoles = sessionDoc.data().claimedRoles;
            if (claimedRoles[roleId] === auth.currentUser.uid) {
                claimedRoles[roleId] = null;
                transaction.update(sessionDocRef, { claimedRoles });
            }
        });
        onLeave();
    }
    
    const scenario = rehearsalState?.scenario;
    const myHand = scenario?.playerHands?.[roleId];
    const board = scenario?.handInfo?.board;
    const boardState = scenario?.gameState?.boardState;
    const parseCard = (cardStr) => ({ rank: cardStr.slice(0, -1), suit: cardStr.slice(-1) });

    const handlePlayerCardClick = (cardIndex) => {
        if (mode === 'player' && myHand) {
             if (cardIndex === 0) {
                setCardFlipState(prev => ({ ...prev, card1: !prev.card1 }));
            } else if (cardIndex === 1) {
                setCardFlipState(prev => ({ ...prev, card2: !prev.card2 }));
            }
        }
    };

    const handleDealerBoardClick = async (cardIndex) => {
        if (mode !== 'dealer' || !scenario) return;
        
        const currentBoardState = scenario.gameState.boardState;
        let newState = currentBoardState;

        if (cardIndex >= 0 && cardIndex <= 2 && currentBoardState === 'pre-deal') {
            newState = 'flop';
        } else if (cardIndex === 3 && currentBoardState === 'flop') {
            newState = 'turn';
        } else if (cardIndex === 4 && currentBoardState === 'turn') {
            newState = 'river';
        } else {
            return;
        }
        await updateDoc(sessionDocRef, { "scenario.gameState.boardState": newState });
    };
    
    if (mode === 'player') {
        return (
            <div className="min-h-screen w-full bg-gray-900 text-white p-4 flex flex-col items-center justify-center overflow-hidden fixed inset-0">
                <div className="absolute top-2 left-4 text-sm text-gray-400">
                    <p>좌석 #{roleId}</p>
                </div>
                <div className="flex justify-center items-center w-full h-full flex-grow gap-4 sm:gap-6">
                    {!scenario || !myHand ? (
                        <>
                            <Card isFaceDown={true} size="player" />
                            <Card isFaceDown={true} size="player" />
                        </>
                    ) : (
                        <>
                            <Card {...parseCard(myHand[0])} isFaceDown={!cardFlipState.card1} onClick={() => handlePlayerCardClick(0)} size="player" />
                            <Card {...parseCard(myHand[1])} isFaceDown={!cardFlipState.card2} onClick={() => handlePlayerCardClick(1)} size="player" />
                        </>
                    )}
                </div>
                <button onClick={handleLeaveClick} className="absolute bottom-4 bg-black bg-opacity-50 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-800">세션 나가기</button>
            </div>
        );
    }

    if (mode === 'dealer') {
        return (
            <div className="min-h-screen w-full bg-green-900 text-white p-4 flex flex-col items-center justify-center overflow-hidden fixed inset-0">
                 <div className="absolute top-2 left-4 text-sm text-gray-400">
                    <p>딜러</p>
                </div>
                 {error ? <p className="text-yellow-400 text-2xl">{error}</p> :
                    <div className="flex justify-center items-center flex-wrap gap-2 sm:gap-4 w-full h-full">
                         {!scenario ? <p className="text-2xl">감독이 시나리오를 생성하기를 기다리는 중...</p> :
                         (board && <>
                            <Card {...parseCard(board[0])} isFaceDown={boardState !== 'flop' && boardState !== 'turn' && boardState !== 'river'} size="dealer" onClick={() => handleDealerBoardClick(0)} />
                            <Card {...parseCard(board[1])} isFaceDown={boardState !== 'flop' && boardState !== 'turn' && boardState !== 'river'} size="dealer" onClick={() => handleDealerBoardClick(1)} />
                            <Card {...parseCard(board[2])} isFaceDown={boardState !== 'flop' && boardState !== 'turn' && boardState !== 'river'} size="dealer" onClick={() => handleDealerBoardClick(2)} />
                            <Card {...parseCard(board[3])} isFaceDown={boardState !== 'turn' && boardState !== 'river'} size="dealer" onClick={() => handleDealerBoardClick(3)} />
                            <Card {...parseCard(board[4])} isFaceDown={boardState !== 'river'} size="dealer" onClick={() => handleDealerBoardClick(4)} />
                        </>)}
                    </div>
                }
                <button onClick={handleLeaveClick} className="absolute bottom-4 bg-black bg-opacity-50 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-800">세션 나가기</button>
            </div>
        );
    }

    return null;
}

// --- Main App Component ---
export default function App() {
    const [mode, setMode] = useState('select');
    const [roleId, setRoleId] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);
        setDb(firestoreDb);
        setAuth(firebaseAuth);

        const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
            if (user) {
                setIsAuthReady(true);
            } else {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (error) {
                    console.error("Firebase Auth Error:", error);
                }
            }
        });

        return () => unsubscribe();
    }, []);

    const handleRoleSelect = (selectedRoleId) => {
        setRoleId(selectedRoleId);
        if(selectedRoleId === 'dealer') {
            setMode('live-dealer');
        } else {
            setMode('live-player');
        }
    };
    
    const handleLeave = () => {
        setRoleId(null);
        setMode('select');
    };

    if (!isAuthReady) {
        return <div className="flex items-center justify-center min-h-screen"><p>인증 및 초기화 중...</p></div>;
    }
    
    switch (mode) {
        case 'director':
            return <DirectorView db={db} setMode={setMode}/>;
        case 'player':
            return <RoleSelectionScreen db={db} auth={auth} onRoleSelect={handleRoleSelect} setMode={setMode} mode="player" />;
        case 'dealer':
            return <RoleSelectionScreen db={db} auth={auth} onRoleSelect={handleRoleSelect} setMode={setMode} mode="dealer" />;
        case 'live-player':
            return <LiveView db={db} auth={auth} mode="player" roleId={roleId} onLeave={handleLeave} />;
        case 'live-dealer':
            return <LiveView db={db} auth={auth} mode="dealer" roleId={roleId} onLeave={handleLeave} />;
        case 'select':
        default:
            return (
                <div className="flex items-center justify-center min-h-screen bg-gray-100">
                    <div className="text-center p-8 bg-white rounded-xl shadow-2xl">
                        <h1 className="text-4xl font-bold mb-2 text-gray-800">포커 리허설 라이브</h1>
                        <p className="text-gray-600 mb-8">역할을 선택하여 리허설을 시작하세요.</p>
                        <div className="space-y-4">
                            <button onClick={() => setMode('director')} className="w-full text-xl font-bold text-white bg-red-600 py-4 px-8 rounded-lg hover:bg-red-700 transition-transform transform hover:scale-105">감독 모드</button>
                            <button onClick={() => setMode('player')} className="w-full text-xl font-bold text-white bg-blue-600 py-4 px-8 rounded-lg hover:bg-blue-700 transition-transform transform hover:scale-105">플레이어 모드</button>
                            <button onClick={() => setMode('dealer')} className="w-full text-xl font-bold text-white bg-gray-700 py-4 px-8 rounded-lg hover:bg-gray-800 transition-transform transform hover:scale-105">딜러 모드</button>
                        </div>
                    </div>
                </div>
            );
    }
}
