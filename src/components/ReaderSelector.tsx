import React, { useState } from 'react';
import { User, Shield, X, Lock } from 'lucide-react';
import backgroundDesk from '../assets/images/tang_ketab_archival_desk_1791013805237.jpg';

interface ReaderSelectorProps {
  onSelect: (role: 'pembaca' | 'admin') => void;
}

export function ReaderSelector({ onSelect }: ReaderSelectorProps) {
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleAdminSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === '1234') {
      onSelect('admin');
    } else {
      setErrorMsg('Sandi salah! Coba lagi.');
      setPasswordInput('');
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-6 text-[#FBF9F5] font-serif">
      {/* Background Image */}
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center brightness-50"
        style={{ backgroundImage: `url(${backgroundDesk})` }}
      />
      
      {/* Content */}
      <div className="relative z-10 max-w-sm w-full space-y-12 text-center">
        <h1 className="text-5xl font-display font-bold tracking-tight text-white drop-shadow-lg">
          TANG_KETAB
        </h1>
        
        <div className="grid gap-6">
          <button
            type="button"
            onClick={() => onSelect('pembaca')}
            className="flex items-center justify-center gap-3 p-5 bg-[#78350F]/80 hover:bg-[#78350F] text-white rounded-lg transition-all text-xl font-medium backdrop-blur-sm border border-white/20 shadow-xl cursor-pointer"
          >
            <User size={24} />
            Masuk sebagai Pembaca
          </button>
        </div>
      </div>

      {/* Discreet Admin Link at Bottom Corner */}
      <button
        type="button"
        onClick={() => {
          setShowPasswordModal(true);
          setErrorMsg('');
          setPasswordInput('');
        }}
        className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 text-xs text-white/40 hover:text-white transition-colors p-3 cursor-pointer bg-black/30 backdrop-blur-xs rounded-md"
        title="Admin Login"
      >
        <Shield size={14} />
        <span>Admin</span>
      </button>

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-xs bg-[#FBF9F5] text-[#1C1917] p-6 rounded-lg shadow-2xl border border-[#D6CEBE] space-y-4 font-serif">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#78350F]">
                <Lock size={18} />
                <h3 className="font-display font-semibold text-lg">Sandi Admin</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswordModal(false)}
                className="p-1 text-[#57534E] hover:text-[#1C1917]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAdminSubmit} className="space-y-4">
              <div>
                <input
                  type="password"
                  autoFocus
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Masukkan sandi..."
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D6CEBE] text-[#1C1917] focus:outline-none focus:border-[#78350F]"
                />
                {errorMsg && (
                  <p className="text-xs text-[#9A3412] mt-1.5">{errorMsg}</p>
                )}
              </div>

              <button
                type="submit"
                className="w-full py-2.5 text-xs font-semibold text-white bg-[#78350F] hover:bg-[#5C280B] transition-colors"
              >
                Masuk sebagai Admin
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
