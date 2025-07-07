setup-hooks:
	@cd .git/hooks; ln -s -f ../../contrib/git-hooks/* ./
	@pnpm install -g prettier @mysten/prettier-plugin-move
