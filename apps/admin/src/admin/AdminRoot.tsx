'use client';

import { App, ConfigProvider, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { api, type Session } from './api';
import { LoginView } from './LoginView';
import { SpotsWorkspace } from './SpotsWorkspace';

export function AdminRoot() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .refresh()
      .then((result) => {
        if (active) {
          setSession({ admin: result.admin, csrf: result.csrf_token });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setChecking(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1E6B57',
          colorInfo: '#1E6B57',
          borderRadius: 6,
          fontFamily:
            '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <App>
        {checking ? (
          <div className="boot-screen">
            <Spin size="large" />
            <p>正在检查后台会话…</p>
          </div>
        ) : session === null ? (
          <LoginView
            onSession={(nextSession) => {
              setSession(nextSession);
            }}
          />
        ) : (
          <SpotsWorkspace
            session={session}
            onLogout={() => {
              void api
                .logout(session.csrf)
                .catch(() => undefined)
                .finally(() => setSession(null));
            }}
            onExpired={() => {
              setSession(null);
            }}
          />
        )}
      </App>
    </ConfigProvider>
  );
}
