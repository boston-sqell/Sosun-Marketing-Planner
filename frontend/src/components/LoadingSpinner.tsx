import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
  fullPage?: boolean;
  size?: number;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Loading...',
  fullPage = false,
  size = 40
}) => {
  const content = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      ...(fullPage ? { minHeight: '100vh' } : { padding: '40px' })
    }}>
      <div
        className="spinning-anim"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          border: '3px solid var(--border)',
          borderTopColor: 'var(--primary)',
          borderRadius: '50%'
        }}
      />
      <span style={{
        fontSize: '14px',
        color: 'var(--text-muted)',
        fontWeight: 500,
        fontFamily: 'var(--font)'
      }}>
        {message}
      </span>
    </div>
  );

  if (fullPage) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: 'var(--bg)',
        fontFamily: 'var(--font)'
      }}>
        {content}
      </div>
    );
  }

  return content;
};
