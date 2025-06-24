import type { AppRouter } from './routertype';

export default function addExampleRoutes(router: AppRouter) {
	router.get('/users/:id', (req) => new Response(`User ID: ${req.params.id}`));

	// example: return JSON response:
	// example: curl "http://localhost:8787/users/json/1" -i
	router.get('/users/json/:id', ({ params }) => {
		return { username: `joe-${params.id}` };
	});

	router.get('/test', (req: Request) => {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(
			`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`,
		);
	});

	// Example with access to env to access KV database
	// router.get('/', (request, env, ctx) => {
	//   env.KV.get('test');
	// });
}
