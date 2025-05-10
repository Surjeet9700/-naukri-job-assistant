import React from 'react';

interface ErrorBannerProps {
  message: string;
  type?: 'error' | 'warning';
  onClose?: () => void;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, type = 'error', onClose }) => {
  const bgColor = type === 'error' ? '#f8d7da' : '#fff3cd';
  const textColor = type === 'error' ? '#721c24' : '#856404';
  return (
    <div style={{
      background: bgColor,
      color: textColor,
      padding: '8px 12px',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      fontWeight: 500,
      fontSize: 14,
      marginBottom: 8,
      border: `1px solid ${type === 'error' ? '#f5c6cb' : '#ffeeba'}`,
      position: 'relative',
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      {onClose && (
        <button onClick={onClose} style={{
          background: 'none',
          border: 'none',
          color: textColor,
          fontWeight: 'bold',
          fontSize: 16,
          cursor: 'pointer',
          marginLeft: 8,
        }} aria-label="Dismiss error">&times;</button>
      )}
    </div>
  );
};

export default ErrorBanner; 