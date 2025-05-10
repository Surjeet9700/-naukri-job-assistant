import React from 'react';

interface StatusBarProps {
  status: string;
  loading?: boolean;
}

const statusColors: Record<string, string> = {
  Idle: '#e0e0e0',
  Loading: '#f0ad4e',
  Applying: '#5bc0de',
  'Waiting for Question': '#5bc0de',
  Completed: '#5cb85c',
  Error: '#d9534f',
};

const StatusBar: React.FC<StatusBarProps> = ({ status, loading }) => {
  const color = statusColors[status] || '#e0e0e0';
  return (
    <div style={{
      background: color,
      color: '#222',
      padding: '6px 12px',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      fontWeight: 500,
      fontSize: 14,
      marginBottom: 8,
      minHeight: 28,
    }}>
      {loading && (
        <span className="status-spinner" style={{ marginRight: 8 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="#888" strokeWidth="2" opacity="0.3" />
            <path d="M8 1a7 7 0 0 1 7 7" stroke="#222" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      )}
      <span>{status}</span>
    </div>
  );
};

export default StatusBar; 