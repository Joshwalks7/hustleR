import { useState, useEffect } from 'react';
import './App.css';
// --- Firebase & Firestore Imports ---
import { db, auth, googleProvider } from './firebase'; 
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from "firebase/firestore";
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

  // --- 3. LOGIC HANDLERS ---
  
  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setModalView(null);
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
      setModalView(null);
      setView('listings');
      fetchJobs(); 
    } catch (error) {
      console.error("Error adding job: ", error);
      alert("Error posting job. Check database rules!");
    }
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
                    <button className="btn-secondary">Message Lister</button>
                    
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
          <div className="modal-content" style={{textAlign: 'center'}}>
            <span className="close" onClick={() => setModalView(null)}>&times;</span>
            
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