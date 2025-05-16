import React from 'react';

type UserInfoProps = {
  userData: {
    id?: number | string;
    name?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };
};

const UserInfoCard: React.FC<UserInfoProps> = ({ userData }) => {
  // Filter out complex nested objects for display
  const displayableFields = Object.entries(userData).filter(
    ([_, value]) => typeof value !== 'object' || value === null
  );

  return (
    <div className="user-info-card">
      <h3 className="card-title">User Information</h3>
      <div className="user-info-content">
        {displayableFields.map(([key, value]) => (
          <div key={key} className="info-row">
            <span className="info-label">{key.charAt(0).toUpperCase() + key.slice(1)}:</span>
            <span className="info-value">{value !== null ? String(value) : 'N/A'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserInfoCard; 