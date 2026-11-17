'use client';

import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  QRCode,
  Space,
  Steps,
  Typography,
} from 'antd';
import { useState } from 'react';
import { api, ApiError, type Session, type TotpSetup } from './api';

interface LoginViewProps {
  onSession: (session: Session) => void;
}

type Step = 'password' | 'totp' | 'bind' | 'recovery';

export function LoginView({ onSession }: LoginViewProps) {
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>('password');
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [pendingSession, setPendingSession] = useState<Session | null>(null);

  const showError = (error: unknown): void => {
    message.error(error instanceof ApiError ? error.message : '登录失败，请稍后重试');
  };

  const handlePassword = async (values: {
    username: string;
    password: string;
  }): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.login(values.username, values.password);
      if ('csrf_token' in result) {
        onSession({ admin: result.admin, csrf: result.csrf_token });
        return;
      }
      if ('mfa_required' in result) {
        setMfaToken(result.mfa_token);
        setStep('totp');
        return;
      }
      if ('must_bind_totp' in result) {
        const setupResult = await api.totpSetup(result.mfa_token);
        setMfaToken(result.mfa_token);
        setSetup(setupResult);
        setStep('bind');
      }
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (values: { code: string }): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.totpVerify(mfaToken, values.code);
      onSession({ admin: result.admin, csrf: result.csrf_token });
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBind = async (values: { code: string }): Promise<void> => {
    setLoading(true);
    try {
      const result = await api.totpEnable(mfaToken, values.code);
      setRecoveryCodes(result.recovery_codes);
      setPendingSession({ admin: result.admin, csrf: result.csrf_token });
      setStep('recovery');
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div className="brand-mark">SZ</div>
        <p className="brand-kicker">深圳钓鱼助手</p>
        <h1>运营后台</h1>
        <p className="brand-copy">
          钓点录入、核实与发布。所有关键操作都会留下审计记录。
        </p>
      </section>

      <Card className="login-card" variant="borderless">
        <Steps
          size="small"
          current={step === 'password' ? 0 : step === 'recovery' ? 2 : 1}
          items={[{ title: '账号' }, { title: '二次验证' }, { title: '完成' }]}
          className="login-steps"
        />

        {step === 'password' && (
          <Form layout="vertical" onFinish={handlePassword} requiredMark={false}>
            <Form.Item
              label="账号"
              name="username"
              rules={[{ required: true, message: '请输入后台账号' }]}
            >
              <Input size="large" autoComplete="username" placeholder="operator01" />
            </Form.Item>
            <Form.Item
              label="密码"
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder="至少 12 位"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              登录
            </Button>
          </Form>
        )}

        {step === 'totp' && (
          <Form layout="vertical" onFinish={handleTotp} requiredMark={false}>
            <Alert
              type="info"
              showIcon
              message="请输入认证器中的 6 位动态码"
              className="login-alert"
            />
            <Form.Item
              label="动态码"
              name="code"
              rules={[{ required: true, len: 6, message: '请输入 6 位动态码' }]}
            >
              <Input size="large" inputMode="numeric" maxLength={6} autoFocus />
            </Form.Item>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Button type="primary" htmlType="submit" size="large" block loading={loading}>
                验证并进入
              </Button>
              <Button type="link" block onClick={() => setStep('password')}>
                返回账号登录
              </Button>
            </Space>
          </Form>
        )}

        {step === 'bind' && setup !== null && (
          <Form layout="vertical" onFinish={handleBind} requiredMark={false}>
            <Alert
              type="warning"
              showIcon
              message="首次登录需要绑定 TOTP"
              description="用认证器扫描二维码，或手动输入密钥，再填写当前动态码。"
              className="login-alert"
            />
            <div className="totp-bind">
              <QRCode value={setup.otpauth_uri} size={148} />
              <div>
                <Typography.Text type="secondary">手动密钥</Typography.Text>
                <Typography.Paragraph copyable className="manual-key">
                  {setup.manual_key}
                </Typography.Paragraph>
              </div>
            </div>
            <Form.Item
              label="动态码"
              name="code"
              rules={[{ required: true, len: 6, message: '请输入 6 位动态码' }]}
            >
              <Input size="large" inputMode="numeric" maxLength={6} autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={loading}>
              完成绑定
            </Button>
          </Form>
        )}

        {step === 'recovery' && pendingSession !== null && (
          <div>
            <Alert
              type="success"
              showIcon
              message="TOTP 已绑定"
              description="恢复码只显示一次，请离线保存。每个恢复码只能使用一次。"
              className="login-alert"
            />
            <div className="recovery-grid">
              {recoveryCodes.map((code) => (
                <Typography.Text key={code} copyable code>
                  {code}
                </Typography.Text>
              ))}
            </div>
            <Button
              type="primary"
              size="large"
              block
              onClick={() => onSession(pendingSession)}
            >
              我已保存，进入后台
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
