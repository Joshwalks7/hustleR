import { useState, useEffect } from 'react';
import './App.css';
// --- Firebase & Firestore Imports ---
import { db, auth, googleProvider } from './firebase'; 
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// 1. Define your Admin List here (Replace with your actual email)
const ADMIN_UIDS = [
  "z3zTXliXD4WIIVoot9HrDukdn753",
  "JA1SDF3wZNckLZcKXKlOL5QgyA03",
  "81jfHeqysMfDqZolIXkqIw3zaiv2",
  "JsaLhA3sHUcUMTeYg9WNLRYmYaD2"
]; // Found in the Firebase Auth tab

function App() {
  // --- 1. STATE MANAGEMENT ---
  const [currentUser, setCurrentUser] = useState(null);
  const [jobs, setJobs] = useState([]); 
  const [view, setView] = useState('home'); 
  const [modalView, setModalView] = useState(null); 
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [activeChatJob, setActiveChatJob] = useState(null);
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
    if (modalView !== 'chat' || !activeConversationId) {
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
  }, [modalView, activeConversationId]);

  // --- 3. LOGIC HANDLERS ---
  
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

  const ensureConversationExists = async (conversationId, job) => {
    const conversationRef = doc(db, "conversations", conversationId);
    const existingConversation = await getDoc(conversationRef);

    if (!existingConversation.exists()) {
      await setDoc(conversationRef, {
        jobId: job.id,
        jobTitle: job.title,
        participants: [currentUser.uid, job.ownerId],
        participantNames: {
          [currentUser.uid]: currentUser.displayName || 'User',
          [job.ownerId]: job.employer || 'Lister'
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessage: ''
      });
    }
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
      setActiveChatJob(job);
      setActiveConversationId(conversationId);
      setChatInput('');
      setModalView('chat');
    } catch (error) {
      console.error("Error opening chat: ", error);
      alert("Could not open chat. Check Firestore rules for conversations/messages.");
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
    setActiveConversationId(null);
    setActiveChatJob(null);
    setChatMessages([]);
    setChatInput('');
  };

  // --- 4. JSX (THE UI) ---
  return (
    <div className="app-container">
      <header>
        <nav className="navbar">
          <div className="logo" onClick={() => setView('home')}>Hustle</div>
          <ul className="nav-links">
            <li><button onClick={() => setView('listings')} className="link-btn">Browse Jobs</button></li>
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

            {modalView === 'chat' && activeChatJob && (
              <div className="chat-modal">
                <h2>Chat with {activeChatJob.employer}</h2>
                <p className="chat-context">About: {activeChatJob.title}</p>

                <div className="chat-thread">
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;