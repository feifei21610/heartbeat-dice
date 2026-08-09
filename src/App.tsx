import { useEffect } from 'react';
import { RECONNECT_MAX_ATTEMPTS } from '@game/shared/constants';
import { ErrorBar, ReconnectingBanner, Toast } from './components/Banners';
import { FloatingHearts } from './components/FloatingHearts';
import { GameOverPage } from './pages/GameOverPage';
import { GamePage } from './pages/GamePage';
import { HomePage } from './pages/HomePage';
import { LobbyPage } from './pages/LobbyPage';
import { useOnlineStore } from './store/onlineStore';

export function App() {
  const phase = useOnlineStore((s) => s.phase);
  const snapshot = useOnlineStore((s) => s.snapshot);
  const errorMessage = useOnlineStore((s) => s.errorMessage);
  const toast = useOnlineStore((s) => s.toast);
  const reconnectAttempt = useOnlineStore((s) => s.reconnectAttempt);
  const dismissError = useOnlineStore((s) => s.dismissError);
  const dismissToast = useOnlineStore((s) => s.dismissToast);
  const tryResumeSession = useOnlineStore((s) => s.tryResumeSession);
  const giveUpReconnect = useOnlineStore((s) => s.giveUpReconnect);

  // 刷新页面后自动回到牌桌
  useEffect(() => {
    void tryResumeSession();
  }, [tryResumeSession]);

  // ★ 重连时保留原画面，只叠提示条（playbook §5.2 第 3 点）
  const reconnecting = phase === 'reconnecting';
  const body = () => {
    // 重连中：有快照就守住牌桌，没有（刷新后首帧）就显示等待，不要闪首页
    if (reconnecting) {
      return snapshot ? (
        <GamePage />
      ) : (
        <div className="relative z-10 flex min-h-full items-center justify-center">
          <p className="animate-pulse text-blush/60">正在回到牌桌…</p>
        </div>
      );
    }
    switch (phase) {
      case 'lobby':
        return <LobbyPage />;
      case 'playing':
        return <GamePage />;
      case 'gameOver':
        return <GameOverPage />;
      case 'connecting':
        return (
          <div className="relative z-10 flex min-h-full items-center justify-center">
            <p className="animate-pulse text-blush/60">正在连上…</p>
          </div>
        );
      default:
        return <HomePage />;
    }
  };

  return (
    <div className="min-h-full">
      <FloatingHearts />
      {reconnecting && (
        <ReconnectingBanner
          attempt={reconnectAttempt}
          total={RECONNECT_MAX_ATTEMPTS}
          onGiveUp={giveUpReconnect}
        />
      )}
      <ErrorBar message={errorMessage} onDismiss={dismissError} />
      <Toast message={toast} onDismiss={dismissToast} />
      {body()}
    </div>
  );
}
