import { useState, useEffect } from 'react';
import './App.css';
// --- Firebase & Firestore Imports ---
import { db, auth, googleProvider } from './firebase'; 
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, setDoc, onSnapshot, serverTimestamp, where } from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// 1. Define your Admin List here (Replace with your actual email)
const ADMIN_UIDS = [
  "z3zTXliXD4WIIVoot9HrDukdn753",
  "JA1SDF3wZNckLZcKXKlOL5QgyA03",
  "81jfHeqysMfDqZolIXkqIw3zaiv2",
  "JsaLhA3sHUcUMTeYg9WNLRYmYaD2"
]; // Found in the Firebase Auth tab

const HUSTLE_PLAN_URL = 'https://buy.stripe.com/test_3cI14g1eu175dokdVE3Nm00';

function App() {
  // --- 1. STATE MANAGEMENT ---
  const [currentUser, setCurrentUser] = useState(null);
  const [jobs, setJobs] = useState([]); 
  const [conversations, setConversations] = useState([]);
  const [view, setView] = useState('home'); 
  const [modalView, setModalView] = useState(null); 
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  // Determine if the current user has Admin privileges
  const isAdmin = currentUser && ADMIN_UIDS.includes(currentUser.uid);

  // --- 2. SIDE EFFECTS (Auth Listener & Cloud Data) ---
  
  // Real-time Auth Observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
        setConversations([]);
        setActiveConversationId(null);
        setChatMessages([]);
      }
    });
    return () => unsubscribe(); // Cleanup listener
  }, []);

  const fetchJobs = async () => {
    try {
      const q = query(collection(db, "jobs"), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      const jobsArray = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setJobs(jobsArray);
    } catch (error) {
      console.error("Error fetching jobs: ", error);
    }
  };

  useEffect(() => {
    if (view === 'listings') {
      fetchJobs();
    }
  }, [view]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const conversationsQuery = query(
      collection(db, "conversations"),
      where("participants", "array-contains", currentUser.uid)
    );

    const unsubscribe = onSnapshot(conversationsQuery, (snapshot) => {
      const conversationList = snapshot.docs
        .map((conversationDoc) => ({
          id: conversationDoc.id,
          ...conversationDoc.data()
        }))
        .sort((firstConversation, secondConversation) => {
          const firstTimestamp = firstConversation.lastMessageAt || firstConversation.updatedAt || firstConversation.createdAt;
          const secondTimestamp = secondConversation.lastMessageAt || secondConversation.updatedAt || secondConversation.createdAt;
          const firstMillis = firstTimestamp?.toMillis ? firstTimestamp.toMillis() : 0;
          const secondMillis = secondTimestamp?.toMillis ? secondTimestamp.toMillis() : 0;
          return secondMillis - firstMillis;
        });

      setConversations(conversationList);
      setActiveConversationId((previousConversationId) => {
        if (previousConversationId && conversationList.some((conversation) => conversation.id === previousConversationId)) {
          return previousConversationId;
        }

        return conversationList[0]?.id || null;
      });
    }, (error) => {
      console.error("Error loading conversations: ", error);
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!activeConversationId) {
      setChatMessages([]);
      return;
    }

    const messagesQuery = query(
      collection(db, "conversations", activeConversationId, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const messages = snapshot.docs.map((messageDoc) => ({
        id: messageDoc.id,
        ...messageDoc.data()
      }));
      setChatMessages(messages);
    }, (error) => {
      console.error("Error loading messages: ", error);
    });

    return () => unsubscribe();
  }, [activeConversationId]);

  // --- 3. LOGIC HANDLERS ---
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || null;

  const getOtherParticipantId = (conversation) => {
    if (!currentUser || !conversation?.participants) {
      return null;
    }

    return conversation.participants.find((participantId) => participantId !== currentUser.uid) || null;
  };

  const getConversationName = (conversation) => {
    const otherParticipantId = getOtherParticipantId(conversation);

    if (otherParticipantId && conversation?.participantNames?.[otherParticipantId]) {
      return conversation.participantNames[otherParticipantId];
    }

    return conversation?.jobTitle || 'Conversation';
  };

  const formatConversationTimestamp = (timestamp) => {
    if (!timestamp?.toDate) {
      return '';
    }

    return timestamp.toDate().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };
  
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      handleCloseModal();
    } catch (error) {
      console.error("Login Error: ", error);
      alert("Failed to sign in with Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('home');
      setActiveConversationId(null);
      setChatMessages([]);
    } catch (error) {
      console.error("Logout Error: ", error);
    }
  };

  const handleDelete = async (jobId) => {
    if (window.confirm("Are you sure you want to delete this listing?")) {
      try {
        await deleteDoc(doc(db, "jobs", jobId));
        fetchJobs(); 
      } catch (error) {
        console.error("Error deleting job: ", error);
      }
    }
  };

  const handlePostJob = async (e) => {
    e.preventDefault();
    
    // Safety check: only allow posting if logged in
    if (!currentUser) {
      alert("You must be logged in to post a job!");
      return;
    }

    const newJob = {
      title: e.target.jTitle.value,
      description: e.target.jDesc.value,
      price: Number(e.target.jPrice.value),
      employer: currentUser.displayName, // Uses Google name
      ownerId: currentUser.uid,        // Stores unique ID for later security
      createdAt: new Date() 
    };

    try {
      await addDoc(collection(db, "jobs"), newJob);
      handleCloseModal();
      setView('listings');
      fetchJobs(); 
    } catch (error) {
      console.error("Error adding job: ", error);
      alert("Error posting job. Check database rules!");
    }
  };

  const getConversationId = (jobId, currentUid, ownerUid) => {
    const sortedUids = [currentUid, ownerUid].sort();
    return `${jobId}_${sortedUids[0]}_${sortedUids[1]}`;
  };

  const getDisplayName = (name, fallback) => {
    if (typeof name === 'string' && name.trim()) {
      return name.trim();
    }

    return fallback;
  };

  const ensureConversationExists = async (conversationId, job) => {
    const conversationRef = doc(db, "conversations", conversationId);
    const requesterId = currentUser.uid;
    const listerId = job.ownerId;
    const participants = [requesterId, listerId].sort();
    const participantNames = {
      [requesterId]: getDisplayName(currentUser.displayName, 'User'),
      [listerId]: getDisplayName(job.employer, 'Lister')
    };

    // Upsert path: first click creates the chat, later clicks refresh participant metadata.
    await setDoc(conversationRef, {
      jobId: job.id,
      jobTitle: getDisplayName(job.title, 'Job opportunity'),
      listerId,
      requesterId,
      participants,
      participantNames,
      updatedAt: serverTimestamp()
    }, { merge: true });
  };

  const handleOpenChat = async (job) => {
    if (!currentUser) {
      setModalView('login');
      return;
    }

    if (!job.ownerId) {
      alert("This listing cannot be messaged yet because it has no owner account linked.");
      return;
    }

    if (currentUser.uid === job.ownerId) {
      alert("This is your listing, so there's no lister to message.");
      return;
    }

    try {
      const conversationId = getConversationId(job.id, currentUser.uid, job.ownerId);
      await ensureConversationExists(conversationId, job);
      setActiveConversationId(conversationId);
      setChatInput('');
      setModalView(null);
      setView('chats');
    } catch (error) {
      console.error("Error opening chat: ", error);
      const firebaseCode = error?.code ? ` (${error.code})` : '';
      alert(`Could not open chat${firebaseCode}. Check Firestore rules and listing owner data.`);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const messageText = chatInput.trim();

    if (!messageText || !currentUser || !activeConversationId) {
      return;
    }

    try {
      await addDoc(collection(db, "conversations", activeConversationId, "messages"), {
        text: messageText,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || 'User',
        createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "conversations", activeConversationId), {
        updatedAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: currentUser.uid,
        lastMessage: messageText
      }, { merge: true });

      setChatInput('');
    } catch (error) {
      console.error("Error sending message: ", error);
      alert("Message failed to send.");
    }
  };

  const handleCloseModal = () => {
    setModalView(null);
  };

  const handleOpenPlanCheckout = () => {
    window.open(HUSTLE_PLAN_URL, '_blank', 'noopener,noreferrer');
  };

  // --- 4. JSX (THE UI) ---
  return (
    <div className="app-container">
      <header>
        <nav className="navbar">
          <div className="logo" onClick={() => setView('home')}>Hustle</div>
          <ul className="nav-links">
            <li><button onClick={() => setView('listings')} className="link-btn">Browse Jobs</button></li>
            <li><button onClick={() => setView('plan')} className="link-btn">Hustle Plan</button></li>
            <li>
              <button
                onClick={() => currentUser ? setView('chats') : setModalView('login')}
                className="link-btn"
              >
                Chats
              </button>
            </li>
            {currentUser ? (
              <>
                <li><span>Hi, {currentUser.displayName}</span></li>
                <li><button onClick={handleLogout} className="btn-secondary">Logout</button></li>
              </>
            ) : (
              <li><button onClick={() => setModalView('login')} className="btn-primary">Login</button></li>
            )}
          </ul>
        </nav>
      </header>

      <main>
        {view === 'home' ? (
          <section className="hero">
            <h1>The simple way to get <span className="highlight">things done.</span></h1>
            <p>A marketplace for local help—from lawn care to tree trimming.</p>
            <button className="btn-primary" onClick={() => setView('listings')}>Search Services</button>
          </section>
        ) : view === 'plan' ? (
          <section className="plan-page">
            <div className="plan-card">
              <div className="plan-badge">Hustle Pro Access</div>
              <h1>Unlock Messaging + Posting Power</h1>
              <p>
                Your account can browse listings for free. The Hustle Plan unlocks action mode: message listers,
                create listings, and fully use the marketplace.
              </p>

              <div className="plan-pricing-row">
                <div>
                  <strong>Early Access Plan</strong>
                  <span>Stripe Sandbox Checkout</span>
                </div>
                <button className="btn-primary" type="button" onClick={handleOpenPlanCheckout}>
                  Continue To Checkout
                </button>
              </div>

              <div className="plan-footnote">
                <p>This button opens your hosted Stripe test payment page in a new tab.</p>
                <small>Access-control enforcement will be connected in a later update.</small>
              </div>
            </div>
          </section>
        ) : view === 'chats' ? (
          <section className="chats-page">
            {!currentUser ? (
              <div className="chats-empty-state">
                <h1>Your chats live here</h1>
                <p>Sign in to message listers and keep every job conversation in one place.</p>
                <button className="btn-primary" onClick={() => setModalView('login')}>Sign In to View Chats</button>
              </div>
            ) : (
              <div className="chats-shell">
                <aside className="conversations-panel">
                  <div className="panel-copy">
                    <h1>Chats</h1>
                    <p>Every conversation tied to a job listing appears here for both users.</p>
                  </div>

                  <div className="conversation-list">
                    {conversations.length === 0 ? (
                      <div className="conversation-list-empty">
                        <p>No chats yet.</p>
                        <span>Open a listing and click Message Lister to start one.</span>
                      </div>
                    ) : (
                      conversations.map((conversation) => (
                        <button
                          key={conversation.id}
                          type="button"
                          className={`conversation-card ${activeConversationId === conversation.id ? 'active' : ''}`}
                          onClick={() => setActiveConversationId(conversation.id)}
                        >
                          <div className="conversation-card-top">
                            <strong>{getConversationName(conversation)}</strong>
                            <span>{formatConversationTimestamp(conversation.updatedAt || conversation.createdAt)}</span>
                          </div>
                          <p>{conversation.jobTitle || 'Job opportunity'}</p>
                          <small>{conversation.lastMessage || 'No messages yet. Start the conversation.'}</small>
                        </button>
                      ))
                    )}
                  </div>
                </aside>

                <section className="chat-panel">
                  {activeConversation ? (
                    <>
                      <div className="chat-panel-header">
                        <div>
                          <h2>{getConversationName(activeConversation)}</h2>
                          <p>About: {activeConversation.jobTitle || 'Job opportunity'}</p>
                        </div>
                      </div>

                      <div className="chat-thread chat-page-thread">
                        {chatMessages.length === 0 ? (
                          <p className="chat-empty">No messages yet. Start the conversation.</p>
                        ) : (
                          chatMessages.map((message) => {
                            const isCurrentUserSender = currentUser && message.senderId === currentUser.uid;
                            return (
                              <div
                                key={message.id}
                                className={`chat-bubble ${isCurrentUserSender ? 'sent' : 'received'}`}
                              >
                                <p>{message.text}</p>
                                <small>{isCurrentUserSender ? 'You' : message.senderName || 'Lister'}</small>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <form className="chat-input-row" onSubmit={handleSendMessage}>
                        <input
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Type your message..."
                          required
                        />
                        <button type="submit" className="btn-primary">Send</button>
                      </form>
                    </>
                  ) : (
                    <div className="chat-panel-empty">
                      <h2>Select a chat</h2>
                      <p>Choose a conversation on the left, or start one from a job listing.</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </section>
        ) : (
          <section className="marketplace">
            <div className="market-header">
              <h1>Marketplace Listings</h1>
              <button 
                onClick={() => currentUser ? setModalView('postJob') : setModalView('login')} 
                className="btn-primary"
              >
                Post New Job +
              </button>
            </div>
            <div className="listings-grid">
              {jobs.length === 0 ? <p>No jobs found.</p> : jobs.map((job) => (
                <div key={job.id} className="job-card">
                  <h3>{job.title}</h3>
                  <p>{job.description}</p>
                  <div className="price">${job.price}</div>
                  <p><small>Posted by: {job.employer}</small></p>
                  
                  <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button className="btn-secondary" onClick={() => handleOpenChat(job)}>Message Lister</button>
                    
                    {/* Admin/Owner Conditional Delete Button */}
                    {(isAdmin || (currentUser && currentUser.uid === job.ownerId)) && (
                      <button 
                        onClick={() => handleDelete(job.id)}
                        style={{ 
                          background: isAdmin ? '#6a1b9a' : '#ff4d4d', 
                          color: 'white', 
                          border: 'none', 
                          padding: '5px 12px', 
                          borderRadius: '4px', 
                          cursor: 'pointer' 
                        }}
                      >
                        {isAdmin ? "Admin Delete" : "Delete"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* MODAL SYSTEM */}
      {modalView && (
        <div className="modal">
          <div className={`modal-content ${modalView === 'chat' ? 'chat-modal-content' : ''}`} style={modalView === 'chat' ? {} : {textAlign: 'center'}}>
            <span className="close" onClick={handleCloseModal}>&times;</span>
            
            {modalView === 'login' && (
              <div className="login-modal">
                <h2>Welcome to Hustle</h2>
                <p>Sign in to post jobs and connect with locals.</p>
                <button 
                  onClick={handleGoogleLogin} 
                  className="btn-primary" 
                  style={{width: '100%', marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px'}}
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="20px"/>
                  Sign in with Google
                </button>
              </div>
            )}

            {modalView === 'postJob' && (
              <form onSubmit={handlePostJob}>
                <h2>Post a Listing</h2>
                <input name="jTitle" placeholder="Job Title" required />
                <textarea name="jDesc" placeholder="Description" required></textarea>
                <input name="jPrice" type="number" placeholder="Budget ($)" required />
                <button type="submit" className="btn-primary">Post Now</button>
              </form>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

export default App;