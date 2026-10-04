import React from 'react';
import { User, Shield } from 'lucide-react';
import backgroundDesk from '../assets/images/tang_ketab_archival_desk_1791013805237.jpg';

interface ReaderSelectorProps {
  onSelect: (role: 'pembaca' | 'admin') => void;
}

export function ReaderSelector({ onSelect }: ReaderSelectorProps) {
  const handleAdminClick = () => {
    const pwd = prompt('Masukkan Sandi Admin:');
    if (pwd === '1234') {
      onSelect('admin');
    } else if (pwd !== null) {
      alert('Sandi salah!');
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
            onClick={() => onSelect('pembaca')}
            className="flex items-center justify-center gap-3 p-5 bg-[#78350F]/80 hover:bg-[#78350F] text-white rounded-lg transition-all text-xl font-medium backdrop-blur-sm border border-white/20 shadow-xl"
          >
            <User size={24} />
            Masuk sebagai Pembaca
          </button>
        </div>
      </div>

      {/* Discreet Admin Link at Bottom Corner */}
      <button
        onClick={handleAdminClick}
        className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 text-xs text-white/30 hover:text-white/80 transition-colors p-2"
        title="Admin Login"
      >
        <Shield size={14} />
        <span>Admin</span>
      </button>
    </div>
  );
}
