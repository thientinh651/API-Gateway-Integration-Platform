import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';

export function LoginForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error('Nhập tên đăng nhập');
      return;
    }
    sessionStorage.setItem('gw_session', '1');
    sessionStorage.setItem('gw_user', username.trim());
    toast.success('Demo UI: session lưu sessionStorage — chuyển vào dashboard');
    navigate('/');
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-user" className="text-foreground">
          Tên đăng nhập
        </Label>
        <Input
          id="login-user"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="admin"
          className="bg-input border-border text-foreground"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-pass" className="text-foreground">
          Mật khẩu
        </Label>
        <Input
          id="login-pass"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="bg-input border-border text-foreground"
        />
      </div>
      <Button type="submit" className="w-full bg-primary hover:bg-primary/90">
        Đăng nhập
      </Button>
    </form>
  );
}
