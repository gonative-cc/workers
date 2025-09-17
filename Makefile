setup-hooks:
	@cd .git/hooks; ln -s -f ../../contrib/git-hooks/* ./
	@bun add -g prettier @mysten/prettier-plugin-move
