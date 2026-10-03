import type { Metadata } from 'next';
import { AgentConsole } from '@/components/agent-console';

export const metadata: Metadata = {
  title: 'Agent console',
  description:
    'Drive ORBITGENE over a live MCP JSON-RPC 2.0 endpoint. Nine typed tools, real request and response logging, and mutations through the same service layer as the interface.',
  alternates: { canonical: '/agent' },
};

export default function AgentPage() {
  return <AgentConsole />;
}