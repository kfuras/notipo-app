"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useApi, useApiCall } from "@/hooks/use-api";
import { useAuth } from "@/lib/auth-context";
import { capture } from "@/lib/posthog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Lock, Trash2, Loader2, Key, Copy, Check } from "lucide-react";

interface AccountData {
  data: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    apiKey: string;
    createdAt: string;
    tenant: {
      name: string;
      slug: string;
      plan: string;
      createdAt: string;
    };
  };
}

export default function AccountPage() {
  const { logout } = useAuth();
  const { call } = useApiCall();
  const { data: account, loading } = useApi<AccountData>("/api/account");
  const router = useRouter();

  // API key copy state
  const [copied, setCopied] = useState(false);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account state
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setPasswordLoading(true);
    try {
      await call("/api/account/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
      });
      toast.success("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      await call("/api/account", {
        method: "DELETE",
        body: { password: deletePassword },
      });
      capture("account_deleted");
      logout();
      router.push("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
      setDeleteLoading(false);
    }
  };

  const a = account?.data;

  if (loading || !a) {
    return (
      <div className="space-y-6 max-w-2xl">
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isOwner = a.role === "OWNER";

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Account</h1>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{a.email}</span>
          </div>
          {a.name && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">{a.name}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Role</span>
            <Badge variant="outline">{a.role}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Organization</span>
            <span className="text-sm font-medium">{a.tenant.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Member since</span>
            <span className="text-sm font-medium">
              {new Date(a.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="w-5 h-5" />
            API Key
          </CardTitle>
          <CardDescription>Use this key to authenticate API requests from external tools.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={a.apiKey}
              readOnly
              className="font-mono text-sm"
              onFocus={(e) => { e.target.type = "text"; }}
              onBlur={(e) => { e.target.type = "password"; }}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(a.apiKey);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Change Password
          </CardTitle>
          <CardDescription>Update your password to keep your account secure.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}>
              {passwordLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Update Password
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            {isOwner
              ? "Deleting your account will permanently remove your organization and all associated data including posts, categories, and jobs."
              : "Deleting your account will remove your access to this organization."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showDeleteConfirm ? (
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Account
            </Button>
          ) : (
            <div className="space-y-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5">
              <p className="text-sm font-medium text-destructive">
                Enter your password to confirm account deletion. This action cannot be undone.
              </p>
              <div className="space-y-2">
                <Label htmlFor="deletePassword">Password</Label>
                <Input
                  id="deletePassword"
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Enter your password"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={deleteLoading || !deletePassword}
                >
                  {deleteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Permanently Delete
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeletePassword("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
