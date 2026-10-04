import React from 'react';
import { User, Shield } from 'lucide-react';
import backgroundDesk from '../assets/images/tang_ketab_archival_desk_1791013805237.jpg';

interface ReaderSelectorProps {
  onSelect: (role: 'pembaca' | 'admin') => void;
}

export function ReaderSelector({ onSelect }: ReaderSelectorProps) {
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
            className="flex items-center justify-center gap-3 p-5 bg-[#78350F]/80 hover:bg-[#78350F] text-white rounded-lg transition-all text-xl font-medium backdrop-blur-sm border border-white/20"
          >
            <User size={24} />
            Pembaca
          </button>
          
          <button
            onClick={() => onSelect('admin')}
            className="flex items-center justify-center gap-3 p-5 bg-[#1C1917]/80 hover:bg-[#1C1917] text-white rounded-lg transition-all text-xl font-medium backdrop-blur-sm border border-white/20"
          >
            <Shield size={24} />
            Admin
          </button>
        </div>
      </div>
    </div>
  );
}
