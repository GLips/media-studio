import { Anchor, type AnchorProps } from '@mantine/core';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, Ref } from 'react';

type MantineRouterAnchorProps = AnchorProps & AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> };

function MantineRouterAnchor(props: MantineRouterAnchorProps) {
  return <Anchor {...props} />;
}

const RouterAnchor = createLink(MantineRouterAnchor);

/** A route link drawn as Mantine's Anchor, with the router's typed `to` and `params`. */
export const AnchorLink: LinkComponent<typeof MantineRouterAnchor> = (props) => <RouterAnchor preload="intent" {...props} />;
